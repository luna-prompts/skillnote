# Claude.ai Connector — Integration Plan

**Status**: Planned, awaiting Phase 0 spike
**Owner**: TBD
**Created**: 2026-05-24

## Context

SkillNote currently supports Claude Code, Cursor, Codex, OpenClaw, OpenHands, and a universal target — all filesystem-based. The next surface is **claude.ai** (the web UI at claude.ai, also branded "Cowork" for Team/Enterprise).

The goal is two-way sync of skills between a user's self-hosted SkillNote and their claude.ai account, covering **both personal skills and shared/organization skills**. The user experience target: parity with the existing Claude Code integration — install once, then skills appear and stay in sync automatically.

## Decision: Chrome extension with cookie auth + direct internal API calls

After extensive evaluation (see "Rejected alternatives" below), the chosen path is a browser extension that:

1. Reads the user's claude.ai session cookies via Chrome's `chrome.cookies` API
2. Calls claude.ai's internal REST endpoints (`/api/organizations/{org_id}/skills/*`, `/api/account/.../skills/*`) directly with cookie auth
3. Polls the SkillNote backend for pending sync operations and executes them
4. Pulls claude.ai-authored skills back to SkillNote on a periodic cycle

**Why this beats every other path**:

- Cookies are inaccessible to bookmarklets (HttpOnly), CLIs (no browser session), and desktop apps without embedded webviews. Extensions are the only mechanism with first-class cookie access for non-engineering users.
- Direct REST calls (not DOM automation) means no fragility on UI redesigns — only contract changes break us.
- Full skill bundles (SKILL.md + scripts + assets) are preserved because we call the same upload endpoint the web UI itself uses.
- Self-hosting isolation preserved: skill content flows **user's SkillNote → user's browser → user's claude.ai**. SkillNote-project never touches the data; only ships the open-source extension binary.

### Locked decisions (with rationale)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Scope (personal / org / both) | **Both, org first** | Org skills are higher business value (Team/Enterprise users), better documented endpoints. Personal in v1.1. |
| 2 | Per-skill sync opt-in | **Yes — toggle per skill in SkillNote** | Some skills are dev-only and shouldn't leak to claude.ai. |
| 3 | Conflict policy default | **Ask each time**, with per-integration override | Teams want control on first conflict; defaults can be set later. |
| 4 | Sync direction default | **Bidirectional** | Matches Claude Code mental model. Restrictable in options. |
| 5 | Plan tier coverage | **All paid tiers** (Pro/Max/Team/Enterprise) | Detect from claude.ai API response. Free users get clear error. |
| 6 | Extension brand | **"SkillNote"** | Aligns with main product. |
| 7 | Self-hosted URL protocol | **HTTPS required**, with `localhost` / `*.local` exception | Mixed-content from HTTPS extension to HTTP backend fails in modern browsers anyway. |
| 8 | Extension source code | **Open-source, MIT** | Matches SkillNote's backend posture. Lets users audit cookie usage (the sensitive permission). |

### Rejected alternatives (and why)

- **MCP server + MCP Apps** — Tools alone can't carry skill bundles with bash-executable scripts. Resources can carry ZIPs but skills end up under Connectors, not in the Skills section.
- **Plugin marketplace via GitHub** — Cowork restricts marketplace sources to github.com private repos; user data routing through any SkillNote-project-hosted GitHub bridge violates self-hosting isolation.
- **Anthropic API workspace (`/v1/skills`)** — Different surface; workspace skills are not synced to personal claude.ai accounts.
- **Cloud storage bridge (Google Drive)** — Functional but skills appear as Drive files, not in Customize → Skills. Read-only into chat, no true bidirectional sync.
- **Desktop app with embedded webview** — Asks users to switch from their browser to a separate app. Larger install surface, no advantage over extension for the cookie-access problem.
- **CLI / local daemon** — Cookie capture impractical for non-engineering users (devtools paste or build OAuth-style capture flow). The browser already holds the cookies; an extension is the right home for code that uses them.
- **Manual ZIP export** — Not sync, just better export. Useful as a fallback only.

## Architecture overview

```
┌─────────────────────────┐                  ┌──────────────────────┐
│  SkillNote backend      │                  │  Chrome extension    │
│  (self-hosted)          │                  │  (in user's browser) │
│                         │                  │                      │
│  - skills table         │◀─── REST ───────▶│  - background worker │
│  - sync_operations      │   (extension     │  - cookie reader     │
│  - claude_ai_links      │    token auth)   │  - claude.ai client  │
│                         │                  │  - skillnote client  │
└─────────────────────────┘                  └──────────┬───────────┘
                                                        │
                                                        │ cookies + REST
                                                        ▼
                                             ┌──────────────────────┐
                                             │  claude.ai           │
                                             │                      │
                                             │  /api/organizations/ │
                                             │    {id}/skills/...   │
                                             │  /api/account/       │
                                             │    skills/...        │
                                             └──────────────────────┘
```

Three actors, clear responsibilities:

- **SkillNote backend** is the source of truth. It enqueues sync operations whenever skills change.
- **Extension** is the messenger. It reads cookies, executes operations against claude.ai, reports back, and runs a reverse-sync poll.
- **claude.ai** is the destination/source. It exposes internal REST endpoints (no official API) that the extension calls with the user's session.

The data path **user's SkillNote → user's browser → user's claude.ai** never touches SkillNote-project infrastructure.

---

## Component 1 — SkillNote backend

### Database schema (Alembic migration 0011)

**`claude_ai_integrations`** — one row per paired browser/extension

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | FK, nullable | Populated when ACL ships |
| `extension_token` | TEXT | Hashed at rest |
| `claude_ai_org_id` | TEXT | Discovered from claude.ai on first sync |
| `scope` | ENUM | `personal` \| `organization` \| `both` |
| `status` | ENUM | `active` \| `cookie_expired` \| `disconnected` \| `error` |
| `browser_label` | TEXT | "Chrome on MacBook Pro" (for the UI list) |
| `last_sync_at` | TIMESTAMP | |
| `last_error` | TEXT | nullable |
| `created_at` / `updated_at` | TIMESTAMP | |

**`claude_ai_skill_links`** — mapping between SkillNote skills and claude.ai skills

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `integration_id` | FK | |
| `skillnote_skill_id` | FK, nullable | Nullable for claude.ai-authored skills awaiting import |
| `skillnote_version_id` | FK | Last version pushed to claude.ai |
| `claude_ai_skill_id` | TEXT | claude.ai's internal skill ID |
| `claude_ai_version` | TEXT | claude.ai's version identifier |
| `last_seen_at` | TIMESTAMP | |
| `direction` | ENUM | `outbound` \| `inbound` \| `both` |
| `conflict_state` | ENUM | `none` \| `diverged` \| `resolved` |

**`claude_ai_sync_operations`** — the work queue the extension drains

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `integration_id` | FK | |
| `kind` | ENUM | `upload` \| `update` \| `delete` \| `list` \| `fetch_one` |
| `skill_id` | FK, nullable | Nullable for `list` operations |
| `payload` | JSONB | Op-specific: ZIP URL, target IDs, etc. |
| `status` | ENUM | `pending` \| `in_progress` \| `completed` \| `failed` |
| `attempts` | INT | |
| `last_error` | TEXT | |
| `created_at` / `completed_at` | TIMESTAMP | |

### New API endpoints

All under `/v1/integrations/claude-ai/`. Backend module: `backend/app/api/claude_ai_integration.py`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/extension/pair` | Begin pairing — return 6-digit code |
| `POST` | `/extension/redeem` | Extension exchanges approved pairing code for token |
| `GET` | `/status` | Status panel data (sync count, errors, last activity) |
| `GET` | `/extension/operations` | Extension polls for pending ops |
| `POST` | `/extension/operations/{id}/complete` | Extension reports success/failure |
| `POST` | `/extension/imported-skill` | Reverse-sync: extension uploads claude.ai-authored skill |
| `GET` | `/extension/list-known-skills` | Extension fetches claude.ai skill IDs for diffing |
| `DELETE` | `/integrations/{id}` | User disconnects a browser |
| `PATCH` | `/integrations/{id}` | Update scope/conflict policy for a specific browser |

### Event hooks in existing skill flow

In `backend/app/api/skills.py`, the existing publish / update / delete endpoints emit sync events:

- Skill publish (new version) → enqueue `upload` or `update` op for each active integration with `direction ∈ {outbound, both}`
- Skill delete → enqueue `delete` op
- Integration `connect` → enqueue initial `list` + reconcile ops
- Periodic timer (15 min, APScheduler) → enqueue `list` op for every active integration (catches claude.ai-side authoring)

### Bundle compatibility check

Existing `LocalBundleStorage` produces standard SKILL.md + bundled-files ZIPs. **Phase 0 spike must verify** claude.ai's upload endpoint accepts this exact format, or we add a thin transform.

### Extension pairing flow (auth model)

The user never pastes a token. The flow:

1. User opens extension options → pastes SkillNote URL (the only manual entry)
2. Extension calls `POST /v1/integrations/claude-ai/extension/pair` → SkillNote returns `{ pairing_code: "ABC123", pairing_url: "https://skillnote.acme/pair?code=ABC123" }`
3. Extension opens `pairing_url` in a new tab — user lands in SkillNote (signing in if not)
4. SkillNote shows: "A SkillNote browser extension wants to connect. Code: `ABC123`. Approve?"
5. User clicks Approve → pairing is marked approved server-side
6. Extension (polling `redeem`) gets back its long-lived extension token
7. Extension stores token in `chrome.storage.local`

Pattern matches Spotify Connect, Plex device pairing, Zoom desktop. Zero tokens visible to the user.

---

## Component 2 — Chrome extension

**Repo location**: `extensions/claude-ai/` as a sibling to existing `cli/` and `plugin/` directories.

### File structure

```
extensions/claude-ai/
├── manifest.json
├── public/icons/                 (16/32/48/128 px)
├── src/
│   ├── background/
│   │   ├── index.ts              service worker entry
│   │   ├── sync-engine.ts        the loop: poll → execute → report
│   │   ├── cookie-watcher.ts     chrome.cookies.onChanged listener
│   │   └── alarm.ts              chrome.alarms periodic ticks
│   ├── lib/
│   │   ├── claude-ai-client.ts   REST client + cookie auth
│   │   ├── skillnote-client.ts   REST client + extension token auth
│   │   └── types.ts              shared Operation, Skill, etc.
│   ├── popup/                    toolbar status panel
│   │   ├── popup.html
│   │   ├── popup.tsx
│   │   └── popup.css
│   ├── options/                  full-page settings
│   │   ├── options.html
│   │   ├── options.tsx
│   │   └── options.css
│   └── shared/
│       └── storage.ts            chrome.storage wrapper
├── package.json
├── tsconfig.json
└── vite.config.ts                builds to /dist for Web Store
```

### Manifest (Manifest V3)

```json
{
  "manifest_version": 3,
  "name": "SkillNote",
  "version": "0.1.0",
  "description": "Sync your SkillNote skills to claude.ai automatically",
  "permissions": ["cookies", "storage", "alarms", "notifications"],
  "host_permissions": ["https://claude.ai/*", "https://claude.com/*"],
  "optional_host_permissions": ["http://*/*", "https://*/*"],
  "background": { "service_worker": "background/index.js", "type": "module" },
  "action": { "default_popup": "popup/popup.html" },
  "options_page": "options/options.html",
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```

`optional_host_permissions` lets the user grant access to their SkillNote URL (arbitrary host). Prompted on first paste.

### Cookie capture

Chrome's `chrome.cookies.get` reads HttpOnly cookies, which is the load-bearing capability:

```ts
const sessionCookie = await chrome.cookies.get({
  url: "https://claude.ai",
  name: "sessionKey",  // exact name to be verified in Phase 0 spike
});
if (!sessionCookie) throw new NotLoggedInError();
```

`chrome.cookies.onChanged` provides realtime login/logout detection:

```ts
chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (cookie.domain.includes("claude.ai") && cookie.name === "sessionKey") {
    if (removed) pauseSync();
    else resumeSync();
  }
});
```

### Claude.ai REST client (contract TBD in Phase 0)

Provisional interface based on community reverse-engineering:

```ts
class ClaudeAIClient {
  async getOrgId(): Promise<string>;                                // from /api/organizations or session
  async listOrgSkills(orgId): Promise<ClaudeAISkill[]>;             // GET /api/organizations/{orgId}/skills/list-org-skills
  async uploadOrgSkill(orgId, zip, name, desc): Promise<UploadRes>; // POST /api/organizations/{orgId}/skills/upload-org-skill
  async deleteOrgSkill(orgId, skillId): Promise<void>;              // POST /api/organizations/{orgId}/skills/delete-org-skill
  async downloadSkillBundle(orgId, skillId): Promise<Blob>;         // path TBD

  // Personal-skill parallel set
  async listPersonalSkills(): Promise<ClaudeAISkill[]>;
  async uploadPersonalSkill(zip, name, desc): Promise<UploadRes>;
  async deletePersonalSkill(skillId): Promise<void>;
}
```

**Unknowns the Phase 0 spike must resolve:**

- Exact session cookie name(s)
- Whether CSRF tokens are required beyond the session cookie
- Exact request format for upload (`multipart/form-data` vs JSON-with-base64)
- Exact response shapes from each endpoint
- Personal skill endpoint paths
- How to fetch a skill's full bundle (with bundled files) for reverse sync
- Session token lifetime
- Rate-limit behavior

### Sync engine

```ts
async function tick() {
  if (!await isConfigured()) return;

  const ops = await skillnoteClient.fetchOperations();

  for (const op of ops) {
    try {
      switch (op.kind) {
        case "upload": {
          const zip = await skillnoteClient.downloadSkillZip(op.skill_id, op.version);
          const result = await claudeAI.uploadOrgSkill(orgId, zip, op.name, op.description);
          await skillnoteClient.completeOp(op.id, { claude_ai_skill_id: result.skill_id, version: result.version });
          break;
        }
        case "delete": {
          await claudeAI.deleteOrgSkill(orgId, op.payload.claude_ai_skill_id);
          await skillnoteClient.completeOp(op.id);
          break;
        }
        case "list": {
          // Reverse sync
          const remoteSkills = await claudeAI.listOrgSkills(orgId);
          const knownIds = await skillnoteClient.listKnownClaudeAIIds();
          for (const remote of remoteSkills) {
            if (!knownIds.includes(remote.id)) {
              const bundle = await claudeAI.downloadSkillBundle(orgId, remote.id);
              await skillnoteClient.importSkill(bundle, remote);
            }
          }
          break;
        }
      }
    } catch (err) {
      if (err instanceof NotLoggedInError) { await pauseAndNotify(); return; }
      await skillnoteClient.completeOp(op.id, { error: err.message });
    }
  }
}

chrome.alarms.create("sync", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(tick);
```

### Extension UI

**Popup** (toolbar click, ~300×400px):

```
┌──────────────────────────────────────┐
│ SkillNote                       ⚙    │
├──────────────────────────────────────┤
│ ✓ Connected to                       │
│   skillnote.acme.com                 │
│                                      │
│ ✓ Logged in to claude.ai             │
│                                      │
│ Synced 12 skills · last 30s ago      │
│                                      │
│ Recent activity:                     │
│ • pdf-extractor → claude.ai          │
│ • financial-analyzer ← claude.ai     │
│ • slack-summary → claude.ai          │
│                                      │
│ [Sync now]  [Open SkillNote]         │
└──────────────────────────────────────┘
```

**Options page** — full-page settings:

- SkillNote URL field (with "Test connection" button)
- Pair status / Unpair button
- Sync scope checkboxes: personal skills / org skills
- Conflict policy radio: ask each time (default) / SkillNote wins / claude.ai wins
- Direction checkboxes: push to claude.ai / pull from claude.ai
- Telemetry opt-in (default off until v1.1)
- Open-source attribution

**Notifications** (OS-level via `chrome.notifications`):

- "Sign in to claude.ai to keep syncing" (cookie expired)
- "Skill conflict: `pdf-extractor` changed on both sides" (with "Review" action)
- "Sync failed: endpoint changed. Update extension." (with "Open Web Store")

---

## Component 3 — SkillNote frontend additions

### New settings page

Path: `src/app/(app)/settings/integrations/claude-ai/page.tsx`

Sections:

1. **Intro & install** — heading, brief description, "Install for Chrome" / "Install for Firefox" buttons linking to extension store listings.
2. **Connected browsers** — list (multiple browsers can pair to the same SkillNote). Each shows: browser label, last sync, status pill, "Disconnect" button.
3. **Default settings** — fallback policy used when a new browser pairs: default scope, default conflict policy, default direction. Overridable per browser.
4. **Activity log** — recent sync events (last 24h / 7d / 30d) with timestamps, skill names, direction, success/failure.

### Per-skill UI

Modify `src/components/skills/skill-detail.tsx`:

- Small badge next to skill title:
  - `✓ Synced to claude.ai` (green) — last sync successful
  - `⏳ Syncing` (amber, animated)
  - `⚠ Conflict` (orange) — both sides changed; click opens resolution
  - `✗ Sync failed` (red) — click shows error
- Hover reveals: timestamp, claude.ai skill ID, last error if any
- Per-skill "Sync to claude.ai" toggle in skill settings (off by default for safety; user opts in per skill, matches decision #2)

### Conflict resolution UI

When `conflict_state = "diverged"`:

- Side-by-side diff of SKILL.md + bundled file lists
- Three buttons: **Keep SkillNote** / **Keep claude.ai** / **Skip for now**
- "Keep both" creates a new SkillNote skill with `-from-claude-ai` suffix (escape hatch)

### CLI command

Add to `cli/src/commands/connect.ts`'s `SUPPORTED_AGENTS`:

```typescript
export const SUPPORTED_AGENTS = ['claude-code', 'openclaw', 'claude-ai'] as const
```

The install script served at `/setup/agent?agent=claude-ai`:

1. Detects user's browser
2. Opens the Chrome Web Store / Firefox AMO listing
3. Prints: "After install, click the SkillNote extension icon and paste this URL: `https://skillnote.acme/`"
4. Optional `--pair` flag triggers the SkillNote pairing approval page immediately

This mirrors existing `claude-code` / `openclaw` UX.

---

## Phase 0 — Discovery spike (1 week, must precede all other work)

Before any production code, validate the technical foundation. Without this, every later phase risks being built on wrong assumptions.

### Spike deliverables

A one-page document in `docs/claude-ai-endpoints.md` containing verified curl examples for:

- `GET /api/organizations` (or wherever org_id comes from)
- `GET /api/organizations/{org_id}/skills/list-org-skills`
- `POST /api/organizations/{org_id}/skills/upload-org-skill`
- `POST /api/organizations/{org_id}/skills/delete-org-skill`
- Skill-bundle download (path TBD)
- Personal-skill equivalents

For each: request method, full path, required headers (including any CSRF), request body shape, response shape, observed status codes, error formats.

### Validation steps

1. Log into claude.ai (Team or Enterprise account)
2. Use devtools Network tab to capture actual requests made when:
   - Uploading a skill manually via Customize → Skills
   - Deleting a skill
   - Loading the Skills list page
   - Downloading a skill (if claude.ai offers that)
3. Replay each captured request via curl with copied cookies
4. Verify: does the replayed upload appear in the user's Skills section identically to manual upload? Are bundled `scripts/` directories intact?
5. Stress-test: upload 10 sequential, observe rate limiting
6. Wait 24h, retry: does the session cookie still work? When does it expire?

### Risks the spike must surface

- **CSRF requirement**: claude.ai likely sends a CSRF token alongside the session cookie. Need to know how to obtain and rotate.
- **Endpoint name drift**: community-reverse-engineered names may be stale by May 2026.
- **Personal vs org endpoint divergence**: paths and payload formats may differ in ways not yet documented.
- **Anti-automation**: claude.ai may inspect User-Agent, request timing, or other fingerprints. If so, extension must mimic browser-origin requests carefully.

### Exit criteria

The spike concludes successfully when:

- All four core operations (list/upload/delete/download) work via replayed curl
- A skill uploaded via curl appears in the Skills section, with full bundle intact
- Session cookie lifetime is documented
- Any CSRF/anti-automation requirements are documented

If exit criteria can't be met (e.g., Anthropic ships hard anti-automation), we re-plan. Possible fallback at that point: build the cloud storage bridge (Drive) for v1 instead.

---

## Phase plan & estimates

| Phase | Work | Duration | Sequencing |
|---|---|---|---|
| 0 | Discovery spike: verify endpoints, payload formats, auth | 1 week | Must precede all |
| 1 | Backend: migration, models, sync queue, API endpoints, event hooks | 1.5 weeks | After Phase 0 |
| 2 | Extension MVP: scaffold, manifest, cookie reader, claude.ai client (push-only) | 2 weeks | After Phase 1 contracts |
| 3 | Extension reverse sync: list, download, import to SkillNote | 1 week | After Phase 2 |
| 4 | Conflict detection + resolution UI (SkillNote frontend) | 1 week | Parallel with Phase 3 |
| 5 | SkillNote settings page + per-skill badges + activity log | 1 week | Parallel with Phase 3-4 |
| 6 | CLI `connect claude-ai` command + install script | 3 days | After Phase 2 |
| 7 | Polish: error messages, telemetry, notifications, Firefox port | 1 week | After Phase 5 |
| 8 | Chrome Web Store + Firefox AMO submission + review wait | 1 week (calendar) | After Phase 7 |

**Total**: ~9 weeks to public beta.
**MVP demoable internally**: after Phase 3 (~5.5 weeks).

---

## Open risks

1. **Anthropic changes the internal endpoints.** Real, especially after our extension is in the wild. Mitigation: anonymized telemetry on 4xx responses, fast extension auto-update via Chrome Web Store, version pinning per claude.ai release. Worst case: extension stops working until selectors/contracts updated and pushed (typically <24h).

2. **Anthropic detects and blocks non-browser-origin requests.** Mitigation: extension calls happen from inside the user's browser context, so requests carry normal browser fingerprint. Lower risk than CLI or headless approaches.

3. **Session cookie rotation is more aggressive than expected.** Mitigation: extension handles 401s gracefully, notifies user to re-login. Adds friction but doesn't break the feature.

4. **Chrome Web Store rejects the listing** because `cookies` permission scrutiny is tightening. Mitigation: clear listing copy explaining the cookie use (same pattern as 1Password, Honey, Grammarly), open-source the code, link to source from listing.

5. **Personal-skill endpoints are gated or have different shape** than org endpoints. Mitigation: ship org-only in v1, personal in v1.1 after additional spike.

6. **Mixed-content (HTTPS extension → HTTP self-hosted SkillNote)** blocks extension users with HTTP-only deployments. Mitigation: extension warns at pair time; document HTTPS requirement; `localhost` exception for dev.

7. **HARDENING_SPEC.md** in repo root suggests existing security review process — claude.ai integration should be added to that document before Phase 7 polish.

## Definition of done (v1.0)

- A user with self-hosted SkillNote and a paid claude.ai account can:
  1. Install the SkillNote extension from Chrome Web Store
  2. Paste their SkillNote URL once in extension options
  3. Approve the pairing in SkillNote (one click)
  4. See all currently-synced skills appear in their claude.ai Customize → Skills section within 2 minutes
  5. Publish a new skill in SkillNote → see it in claude.ai within 60 seconds
  6. Author a skill in claude.ai → see it imported into SkillNote within 15 minutes (next reverse-sync poll)
  7. Edit a skill on both sides → see conflict UI in SkillNote with clear resolution options
  8. Disconnect cleanly → no orphaned state

Plus:

- Open-source extension source on GitHub under MIT
- Privacy policy documenting cookie use
- Settings page in SkillNote showing all paired browsers with status
- Per-skill sync toggle (default off; user opts in)
- HARDENING_SPEC.md updated with claude.ai integration considerations

## Out of scope for v1.0

- Mobile claude.ai (no extensions on mobile browsers)
- Claude Desktop sync (separate filesystem-based mechanism; revisit later)
- Org-admin bulk management UI (admin still uses claude.ai's admin-settings page for org-level provisioning of SkillNote-synced skills)
- Real-time push (we poll; webhook from SkillNote to extension would require persistent connection — defer)
- Multi-org-per-extension (one extension = one paired SkillNote = one claude.ai account; users with multiple claude.ai orgs install in separate browser profiles)

## References

- Anthropic feature requests (informing the "no official API" decision):
  - [anthropics/claude-code#25771](https://github.com/anthropics/claude-code/issues/25771) — closed NOT_PLANNED
  - [anthropics/claude-code#49530](https://github.com/anthropics/claude-code/issues/49530) — closed duplicate
  - [anthropics/claude-code#39929](https://github.com/anthropics/claude-code/issues/39929) — open
- claude.ai admin docs: `https://support.claude.com/en/articles/13119606-provision-and-manage-skills-for-your-organization`
- Connectors directory submission: `https://claude.com/docs/connectors/building/submission`
- Existing SkillNote agent adapter pattern: `cli/src/agents/`
- Existing connect/bridge primitive: `cli/src/commands/connect.ts`, `cli/src/commands/bridge.ts`
- Existing skill bundle pipeline: `backend/app/services/`
- Skill validation rules (mirrored frontend/backend): `src/lib/skill-validation.ts`, `backend/app/validators/skill_validator.py`
