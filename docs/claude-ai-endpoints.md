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

## Sources

- Community reverse-engineering: [Explosion-Scratch/claude-unofficial-api](https://github.com/Explosion-Scratch/claude-unofficial-api/blob/main/DOCS.md)
- Feature requests describing the endpoints from a user perspective:
  - [anthropics/claude-code#39929](https://github.com/anthropics/claude-code/issues/39929)
  - [anthropics/claude-code#49530](https://github.com/anthropics/claude-code/issues/49530) (closed duplicate)
  - [anthropics/claude-code#25771](https://github.com/anthropics/claude-code/issues/25771) (closed NOT_PLANNED)
- Anthropic's own [admin-settings/skills](https://claude.ai/admin-settings/skills) UI which calls these endpoints
