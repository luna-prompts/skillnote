# Claude.ai Internal Endpoints — Phase 0 Spike Document

**Status**: Provisional — values below are based on community reverse-engineering
documented in `anthropics/claude-code` issues and third-party projects
(`claude-unofficial-api`, `unofficial-claude-api`). They MUST be re-verified
against a live claude.ai Team/Enterprise session before the Chrome extension
ships. Each verified contract should be updated here with a captured `curl`
example.

**Last verified**: never. Marked `TODO: verify` throughout.

## How to verify

For each endpoint listed below:

1. Log into claude.ai with a Team or Enterprise account in Chrome.
2. Open DevTools → Network → preserve log.
3. Perform the action manually (upload a skill, delete one, list them).
4. Find the matching XHR in the Network panel.
5. Right-click → Copy → Copy as cURL.
6. Strip the `sec-*` and `priority` headers, replace the session cookie with
   `$COOKIE` env var, and replay.
7. If the replay succeeds and produces the same observable effect (skill
   appears in Customize → Skills), record the verified shape below.

## Authentication

All endpoints below take session cookies — NOT `sk-ant-...` API keys. The
session cookie is set after login at `claude.ai/login` and lives in browser
storage under domain `.claude.ai`.

| Cookie name | Type | Required | Notes |
|---|---|---|---|
| `sessionKey` | HttpOnly | Yes | `TODO: verify name` — community docs reference this name; could be `__Secure-sessionKey` in production |
| `_csrf_token` | Standard | Possibly | `TODO: verify` — claude.ai may require a CSRF token in `X-CSRF-Token` header for mutating requests |
| `lastActiveOrg` | Standard | Often | Used by the UI to pick a default org for unscoped requests |

Browser extensions can read all of these (including HttpOnly) via the
`chrome.cookies` API. Bookmarklets and `document.cookie` cannot read HttpOnly
cookies — this is the load-bearing reason the integration uses an extension.

## Organization skills endpoints (Team / Enterprise)

### List org skills

```
GET /api/organizations/{org_id}/skills/list-org-skills
Cookie: sessionKey=...
```

**Response** (TODO: verify shape):
```json
{
  "skills": [
    {
      "id": "skill_org_01ABCDEF...",
      "name": "financial-analyzer",
      "display_title": "Financial Analyzer",
      "description": "...",
      "version": "epoch_1716422400",
      "created_at": "2026-05-20T10:30:00Z",
      "updated_at": "2026-05-22T14:15:00Z",
      "uploaded_by": { "user_id": "...", "email": "..." }
    }
  ]
}
```

### Upload org skill

```
POST /api/organizations/{org_id}/skills/upload-org-skill
Cookie: sessionKey=...
X-CSRF-Token: ... (TODO: verify if required)
Content-Type: multipart/form-data

(form-data)
display_title: "Financial Analyzer"
files[]: @financial-analyzer.zip
```

Or possibly individual files:
```
files[]: @financial-analyzer/SKILL.md;filename=financial-analyzer/SKILL.md
files[]: @financial-analyzer/scripts/extract.py;filename=financial-analyzer/scripts/extract.py
```

**Response** (TODO: verify):
```json
{
  "skill": {
    "id": "skill_org_01...",
    "name": "financial-analyzer",
    "version": "epoch_...",
    "display_title": "Financial Analyzer"
  }
}
```

### Delete org skill

```
POST /api/organizations/{org_id}/skills/delete-org-skill
Cookie: sessionKey=...
X-CSRF-Token: ...
Content-Type: application/json

{ "skill_id": "skill_org_01..." }
```

**Response**: `204 No Content` or `200` with `{ "deleted": true }` — TODO: verify.

### Get / download skill bundle

```
GET /api/organizations/{org_id}/skills/{skill_id}/download  (TODO: verify path)
Cookie: sessionKey=...
```

**Response**: `application/zip` blob with the skill folder inside (`SKILL.md`
+ bundled files).

**Open question**: does claude.ai offer a per-skill download endpoint, or do
admins only see metadata via the web UI? If no download endpoint exists, the
reverse-sync path needs to capture the bundle some other way — possibly by
parsing the user's manual download from the UI.

## Personal skills endpoints

All endpoints above have a personal-account equivalent under `/api/account/`:

| Org-scope path | Personal equivalent |
|---|---|
| `/api/organizations/{org_id}/skills/list-org-skills` | `/api/account/skills/list-skills` (TODO: verify) |
| `/api/organizations/{org_id}/skills/upload-org-skill` | `/api/account/skills/upload-skill` (TODO: verify) |
| `/api/organizations/{org_id}/skills/delete-org-skill` | `/api/account/skills/delete-skill` (TODO: verify) |
| `/api/organizations/{org_id}/skills/{id}/download` | `/api/account/skills/{id}/download` (TODO: verify) |

The personal endpoints may instead live under `/api/users/{user_id}/skills/`
— this is the second most likely path based on Anthropic's naming
conventions seen in published API surfaces.

## Discovering the user's org_id

Two known mechanisms:

1. **GET /api/organizations** — returns the list of orgs the user belongs to.
   Pick the first / mark as active.
2. **Session cookie `lastActiveOrg`** — set by the UI when the user switches
   orgs. Read by the extension to keep the integration scoped to whatever org
   the user is currently working in.

The extension should call `GET /api/organizations` once at first sync and
cache the result. Subsequent syncs should re-check on every Nth poll (or on
session-cookie change) to catch org switches.

## Anti-automation considerations

Anthropic may apply some or all of these defenses:

- **User-Agent inspection** — requests not coming from a real browser may be
  flagged. Extension requests carry the user's real browser UA, so this is
  not a concern for us; it would be a concern for a server-side proxy.
- **Origin/Referer enforcement** — extension content scripts run in the
  page context with `Origin: https://claude.ai`, naturally satisfying any
  cross-origin checks. The background service worker doesn't have a page
  origin; for those requests we send `fetch` with `credentials: "include"`
  and let chrome attach cookies.
- **CSRF tokens** — many SaaS apps require a CSRF token on mutating
  requests. If claude.ai does, we need to extract it from a known location
  (response header on initial page load, or a meta tag in the HTML). The
  extension can fetch `claude.ai/` once and parse it out.
- **Rate limits** — TBD. Extension should backoff exponentially on 429.

## What if the endpoints are gated or changed

If the spike reveals that:

- **Endpoints require an Enterprise feature flag** not available to Team:
  scope v1 to Enterprise only, surface clear error to Team users.
- **Endpoints require a CSRF token we can't easily extract**: add a content
  script that runs on `claude.ai/*`, extracts the token from the page on
  load, and ships it to the background service worker via `chrome.runtime`
  messaging.
- **Endpoint paths differ from documented**: update this file. The Chrome
  extension's `claude-ai-client.ts` is a single file; selector updates land
  in minutes.
- **Endpoints are completely different shape (e.g. GraphQL)**: probably
  means re-architecting `claude-ai-client.ts`. ~1 day of work.

## Marketplace / Plugins endpoints — VERIFIED via live capture (2026-06-07)

**Status: CONFIRMED.** Captured live from a personal (Max plan) claude.ai web
session via Playwright by driving Customize → Plugins → Personal plugins → `+`
→ Create plugin → Add marketplace → Add from a repository. These are the
endpoints that produce a **named plugin group** under "Personal plugins" (the
Superpowers / Twilio-style group SkillNote wants to become).

All are scoped to `/api/organizations/{org_id}/...` even for a personal account
(the personal account has its own org_id; captured org_id was a normal UUID).
Auth = **session cookie only**. Required custom header: `anthropic-client-platform: web_claude_ai`
(plus `anthropic-client-version`). **No CSRF token / no Authorization header** —
identical auth+header surface to the already-working `skills/upload-skill` call,
so the extension's existing `claude-ai-client.ts` `call()` transport can drive
these directly.

### Create account marketplace (the "Sync" button) — VERIFIED

```
POST /api/organizations/{org_id}/marketplaces/create-account-marketplace
Content-Type: application/json
anthropic-client-platform: web_claude_ai

{ "name": "skillnote", "source": "github", "source_url": "luna-prompts/skillnote" }
```

- `source`: `"github"` (the only value observed; the UI host allowlist is
  github.com / gitlab.com / bitbucket.org / org-configured GitHub Enterprise).
- `source_url`: `owner/repo` shorthand (a full git URL also accepted by the field).
- Server **git-clones the repo and requires `.claude-plugin/marketplace.json` at
  root.** Missing manifest → `400`:
  ```json
  {"type":"error","error":{"type":"invalid_request_error",
   "message":"Marketplace manifest not found at .claude-plugin/marketplace.json",
   "details":{"error_code":"marketplace_sync_manifest_not_found"}}}
  ```

### ⭐ GIT-FREE PATH — Upload plugin (manual marketplace) — VERIFIED END-TO-END

This is the seamless path: NO git, NO GitHub. Proven 2026-06-07 by uploading a
ZIP on a personal Max account → "SkillNote" rendered as its own named group under
Personal plugins (screenshot: repo root `skillnote-group-proof.png`). Two POSTs,
both cookie-auth, both `200`:

**1. Create a MANUAL (non-git) marketplace** (once; reuse its id after):
```
POST /api/organizations/{org_id}/marketplaces/create-account-marketplace
Content-Type: application/json
{ "name": "SkillNote", "source": "manual", "source_url": "" }
```
`source:"manual"` is the key — no host allowlist applies (unlike `source:"github"`).
Returns the marketplace object incl. `id` (e.g. `marketplace_01C8u...`).

**2. Upload (or update) the plugin ZIP into that marketplace:**
```
POST /api/organizations/{org_id}/marketplaces/{marketplace_id}/plugins/account-upload?overwrite=false
Content-Type: multipart/form-data   (the .zip as a form file)
anthropic-client-platform: web_claude_ai
```
- ZIP layout that worked: `.claude-plugin/plugin.json` (name kebab-case, `displayName`
  = pretty label shown as the group title) + `skills/<slug>/SKILL.md`. (898-byte zip
  with 1 skill succeeded.)
- **`overwrite=true` is the SYNC/UPDATE mechanism** — re-POST the regenerated ZIP to
  push changes (re-run on every SkillNote "Sync"). `overwrite=false` is first install.
- Response: the plugin object `{id, name, display_name, description, marketplace_id, ...}`.
- Auth: session cookie + `anthropic-client-platform: web_claude_ai` only. **No CSRF,
  no Authorization** — same surface as `skills/upload-skill`, so the EXTENSION CAN DRIVE
  BOTH POSTS FROM THE BACKGROUND. This makes the whole flow zero-manual-step and git-free.

Supporting reads for this path:
```
GET /api/organizations/{org_id}/marketplaces/{marketplace_id}/plugins/account-list-plugins?limit=100
```

### Deep live tests — VERIFIED 2026-06-07 (build-critical)

- **Upload field name** = `file` (multipart). Endpoint `…/marketplaces/{mp}/plugins/account-upload?overwrite=true`.
- **Branding from `plugin.json` renders**: `display_name`, `description`, `author{name,email,url}`, `category` ✅. `homepage`/`keywords` accepted but NOT returned in the plugin object. **No icon field exists.**
- **`version` is an auto-incrementing upload counter** (`0001`→`0002`→`0003`), NOT the manifest `version` (manifest `9.9.9` was ignored). So you cannot show a real semver; only an internal sequence. "Update available" must key off this counter, not a published semver.
- **`commands/<name>.md` → native slash commands** (rendered as `/sn-search` with description) ✅. Big native win.
- **Skill frontmatter `user_invocable: true` is IGNORED** (stays null) for account-upload skills. Slash invocation comes from `commands/`, not skill frontmatter. (UI still shows skills with a `/name` and "invoke by typing /".)
- **For account-upload, `plugin.json` wins over a bundled `.claude-plugin/marketplace.json`** (the latter's displayName/category were ignored; the marketplace is the auto-created "My Uploads").
- **Bundled MCP server is ACCEPTED + STORED** via `.mcp.json` (or inline `plugin.json.mcpServers`, but not BOTH — duplicate-name → 400). Stored shape: `mcp_servers:{skillnote:{type:"http",url,headers,mcpb}}`. The **`headers` field means a per-user static auth token can be baked in at upload time** (each user's extension injects their own) — sidesteps the "no `${user_config}` on web" limit. A "Connectors" sub-section then appears under the plugin (like Twilio). NOTE: acceptance/storage ≠ runtime execution in plain web chat (still Cowork-only + public-URL/cloud-routed — unproven for plain web; needs a public logging endpoint to confirm).
- **Plugin skills are NOT individually addressable**: `/skills/{id}` → 404, `/skills/{id}/download` → 404, per-skill plugin download → 404. ⇒ NO per-skill delete/download for plugin skills. Management is **whole-plugin (group) only** via overwrite-upload (delete = omit from the next ZIP). This means the existing per-skill reverse-sync/conflict engine (built on custom-skill `download`/`delete-skill`) does NOT apply to the plugin path — P0 must coalesce to a group rebuild+re-upload op.
- **Per-plugin enable/disable** = `PUT /api/organizations/{org}/plugins/{plugin_id}/enabled`. "Uninstall" of an account-uploaded plugin just disables it (re-installable from the user's own marketplace).
- **`install_count`/`enable_count` stayed null** for a self-uploaded+enabled+invoked plugin ⇒ NOT a usable analytics signal for the self-publish case. Keep the `/mnt/skills` scanner.
- **Mount path reconfirmed**: invoked skill read at `/mnt/skills/plugins/skillnote:hello-skillnote/SKILL.md` in plain web chat.

### Plugin enable/disable + retire (verified) — used for collection un-publish

```
PUT /api/organizations/{org_id}/plugins/{plugin_id}/enabled   body {"enabled": false}
```
"Uninstalling" an account-uploaded plugin DISABLES it (re-enableable). This is
how the extension retires a group whose collection was toggled off (verified 200).
Guessed hard-delete paths all 404 (`/marketplaces/{id}/delete`,
`DELETE /marketplaces/{id}`, `delete-account-marketplace`) — no account-marketplace
hard-delete endpoint was found; disable is the supported retire.

### SkillNote-side endpoints the extension calls (this repo)

```
GET /v1/integrations/claude-ai/extension/plugin-groups        → {marketplace_name, groups:[{name,display_name,skill_count}]}
GET /v1/integrations/claude-ai/extension/plugin-bundle?group= → branded plugin ZIP for one published collection (ETag, X-Skill-Count)
PUT /v1/collections/{name}/claude-ai   body {"published": bool} → toggle a collection's claude.ai publishing (upserts row, enqueues publish_group)
```
The extension's `publish_group` op: GET plugin-groups → ensureSkillNoteMarketplace
→ for each group account-upload(overwrite=true) → disable plugins for collections
no longer listed.

### Supporting endpoints (all GET, verified present)

```
GET /api/organizations/{org_id}/marketplaces/list-account-marketplaces
GET /api/organizations/{org_id}/marketplaces/list-default-marketplaces   # Anthropic-curated
GET /api/organizations/{org_id}/marketplaces/ghe-hostnames               # allowed GHE hosts
GET /api/organizations/{org_id}/plugins/list-plugins?enabled_only=true
GET /api/organizations/{org_id}/sync/settings
GET /api/organizations/{org_id}/sync/github/auth                         # GitHub connection state
GET /api/organizations/{org_id}/code/repos/search?q={query}             # repo picker autocomplete
```

### Host allowlist — VERIFIED (kills self-hosted-HTTP path on web)

Pasting a non-git URL (`https://example.com/marketplace.json`) is **rejected**
inline: *"This host isn't supported. Use github.com, gitlab.com, bitbucket.org,
or a GitHub Enterprise instance configured by your organization."* and Sync stays
disabled. ⇒ The web "Add marketplace" CANNOT consume a backend-served HTTP
`marketplace.json`. The source MUST be a git repo on an allowed host. Therefore
SkillNote must **git-publish** to one of those hosts; it cannot serve a
marketplace directly over HTTP for the web surface.

### Implications for SkillNote

- **Path C (extension auto-registers the group) is FEASIBLE**: the extension can
  POST `create-account-marketplace` with cookie auth + `web_claude_ai` header —
  no CSRF blocker — so a "Sync" can create the named group with zero manual paste.
- **But git is unavoidable**: even path C still needs the skills in a git repo on
  github/gitlab/bitbucket with a valid `.claude-plugin/marketplace.json`. So the
  build is: backend git-publishes the user's enabled skills → extension (or user)
  calls create-account-marketplace pointing at that repo.
- Idempotency: re-running with the same `name` replaces (per docs); the repo just
  needs re-pushed commits for updates (omit `version` in plugin.json so changes
  are picked up).

## Sources

- **Live capture 2026-06-07** (Playwright, personal Max session) — endpoints,
  payloads, error bodies, and host allowlist above are first-hand, not inferred.
- Community reverse-engineering: [Explosion-Scratch/claude-unofficial-api](https://github.com/Explosion-Scratch/claude-unofficial-api/blob/main/DOCS.md)
- Feature requests describing the endpoints from a user perspective:
  - [anthropics/claude-code#39929](https://github.com/anthropics/claude-code/issues/39929)
  - [anthropics/claude-code#49530](https://github.com/anthropics/claude-code/issues/49530) (closed duplicate)
  - [anthropics/claude-code#25771](https://github.com/anthropics/claude-code/issues/25771) (closed NOT_PLANNED)
- Anthropic's own [admin-settings/skills](https://claude.ai/admin-settings/skills) UI which calls these endpoints
