# Changelog

All notable changes to SkillNote will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.3.3] - 2026-04-19

### Added
- **Marketplace Import** — paste a GitHub URL (`owner/repo`, full URL, or `.json` marketplace) to import skills into SkillNote. Inspector clones the repo, enumerates `SKILL.md` files, validates frontmatter, and presents a two-pane preview drawer with per-row conflict handling.
- **Browse page** (`/browse`) — home for imported sources with drift-detection badges (amber `N new · M changed` pill), per-source action menu (Resync / Pin / Change tracked ref / Unlink), and a "Paste a URL" empty-state CTA.
- **Two-pane ImportSheet** with shadcn `Resizable` divider — left: skill selection list with checkboxes + per-row conflict dropdown; right: focused skill preview. Auto-save split position via `react-resizable-panels`.
- **DiffDrawer** — click a drift pill to open a three-section drawer (New / Changed / Removed) with per-row checkboxes + forked-skill overwrite warnings.
- **Fork-on-edit** — editing an imported skill triggers a confirmation modal. Backend flips `forked_from_source=TRUE` automatically on any content-changing PATCH.
- **`GET /marketplace/{slug}.json`** publish-back endpoint — every SkillNote collection is exposed as a Claude-Code-compatible manifest with ETag + `Cache-Control: public, max-age=60, must-revalidate`. User-authored skills omitted from the manifest; shown as `⊙ local only` in the UI.
- **Collection integrations** — import banner on collection detail pages, "Browse the community →" nudge on the collections index, `SourceBadge` + `LocalOnlyChip` components ready for skill cards.
- **6 new API endpoints** — `POST /v1/import/inspect`, `POST /v1/import/apply`, `GET /v1/import/sources`, `POST /v1/import/sources/{id}/refresh`, `DELETE /v1/import/sources/{id}`, `GET /marketplace/{slug}.json`.
- **7 Playwright E2E journey tests** — first-time user, upstream change, conflict rename, fork warning, unlink (keep skills), private repo, publish-back.
- **axe-core a11y coverage** — 4 tests across ImportSheet empty/preview and Browse empty/populated states.

### Security
- **URL security layer** — scheme allowlist (`http`, `https`, `git`, `ssh` only), private-IP block covering RFC1918 + CGNAT (100.64.0.0/10) + IPv6 equivalents (`::1`, `fe80::/10`, `fc00::/7`) + AWS metadata endpoint (169.254.169.254) + localhost literal. SSH-form URLs (`user@host:path`) routed through the same gate.
- **Adversarial input matrix** — 60+ parametrized tests covering malicious schemes (`file://`, `javascript:`, `data:`, `gopher:`), SSRF probes, path traversal in refs (`owner/repo@../../etc/passwd`), control characters, 5000-char input, null bytes, embedded newlines.
- **Manifest schema validation** mirroring Claude Code's Zod schemas — `SkillFrontmatter` enforces `^[a-z0-9-]+$` names (≤64 chars), ≤1024-char descriptions, reserved-word rejection (`anthropic`, `claude`).
- **Per-skill apply-time validation** — skills failing `SkillFrontmatter` checks or containing path-traversal (`..`) in `source_path` are skipped with `reason="validation_failed"`. If ALL skills in a source fail, apply aborts with 422 `ALL_SKILLS_INVALID`.
- **Shallow-clone safety caps** — 50 MB repo size limit, 256 KB per-SKILL.md limit, symlink-traversal rejection via resolved-path containment check, no submodule recursion.
- **Token-bucket rate limiter** — 10 imports/min + 60 marketplace-reads/min per client IP. `X-Forwarded-For` aware.

### Changed
- `parse_input` in the input parser supports GitHub shorthand (`owner/repo[@ref]`), full HTTPS/SSH URLs, Azure DevOps (`/_git/`), and generic `.json` marketplace URLs; returns discriminated `ParsedSource` dict or `None` for unrecognized input.
- `POST /v1/skills/{slug}` PATCH handler flips `forked_from_source=TRUE` on any content-changing edit of an imported skill.

### Migrated
- **`0013_import_sources`** — adds `import_sources` table (UUID PK, 19 columns, 3 Postgres enums: `import_source_type`, `import_source_kind`, `import_source_status`) with unique constraint `(url, ref, subpath)` and FK `collection_name → collections.name ON DELETE CASCADE`. Also adds 5 columns to `skills`: `import_source_id` (FK SET NULL), `source_path`, `source_sha`, `source_content_hash`, `forked_from_source`.

### Known limitations (scheduled for v1.1)
- **`on_conflict="replace"`** returns `NOT_IMPLEMENTED_YET` (422); use `rename` or `skip` in v1.
- **Per-row conflict dropdown in ImportSheet** is UI-only; apply sends a single global conflict mode.
- **Refresh `mode=apply`** returns stub `{applied: 0}` — the diff drawer updates the UI but changes are recorded via the UPSERT path from re-applying.
- **GitHub default branch detection** — repos with `master` as default (not `main`) may fail the HEAD-SHA probe until user specifies `@master` explicitly.
- **Plain `https://github.com/owner/repo` URL** (without `.git` suffix or shorthand form) currently rejected as `UNSUPPORTED_SOURCE_TYPE` — users must paste shorthand `owner/repo` in v1.
- **Multi-process deployments** — rate limiter is in-memory (single-process). Migrate to Redis for horizontal scaling.

## [0.3.2] - 2026-04-18

### Added
- **Terminal picker: Create new collection inline.** Typing a name that doesn't match any existing collection surfaces a `✦ Create 'X'` row; Enter creates via `POST /v1/collections` and activates it. A 409 conflict triggers an activate-existing prompt.
- **Terminal picker: Skip option.** Pinned `⊘ Skip` row (always visible) and `Ctrl+K` hotkey, both gated by a confirmation card. Skipping writes `{"collections": []}` so the session starts with no SkillNote skills.
- **Folder-name recommendation.** If `basename(cwd)` matches an existing collection, it gets a `(Recommended)` label and sorts to top. If not, and the folder slug is valid, a `✦ Create 'folder' (Recommended)` row appears at the top.
- **Slash-command `/skillnote:collection`** parity — Create / Skip / Recommended options via AskUserQuestion.
- **Migration `0012_slugify_collection_names`** — renames any pre-existing collection whose name violates the new rule, with two-pass collision-safe ordering + updates to every referenced skill's `collections[]` array.
- **Frontend validator `src/lib/collection-validation.ts`** (mirrors backend) — powers inline error display in `NewCollectionModal` and the inline `CollectionPicker`.
- **Auto-promote implicit collections.** `POST /v1/skills` now auto-inserts any referenced collection into the `collections` table, so every listed name is editable via detail/PUT/DELETE endpoints (previously 404).
- **Standard 422 error envelope.** Added `RequestValidationError` handler that wraps Pydantic 422s as `{"error":{"code":"VALIDATION_ERROR","message":...}}`, matching the rest of the API contract and fixing `[object Object]` toasts in the web UI.

### Changed
- **Collection names locked to `^[a-z0-9_-]+$`** (1-128 chars, no `anthropic`/`claude` reserved-word substrings). Enforced at the backend validator, in the `POST/PATCH /v1/skills` handlers (after `canonicalize_collection_names`), and mirrored in the frontend modals + picker.
- **Collection description rejects XML tags** — closes a stored-XSS vector. `POST` and `PUT` both refuse `<script>`-style payloads with 422.
- **Picker layout polish.** Replaced `★` marker with bracketed `(Recommended)` label (Claude Code native style). Bumped `LEFT_MAX_W` to 60 so long names and Create labels breathe on wide terminals. Clipped long labels with `…` to prevent bleed into the right panel.
- **Premium modal redesign.** Skip + activate-existing modals are now bordered cards with title, body, hairline rule, and action bar (`❯ Primary · ↵   Esc · Cancel`) — no more reverse-video slabs.
- **Footer hints tier down gracefully** across terminal widths, keeping the web URL + GitHub link when room permits.
- **Right-panel preview** shows contextual helper cards when Create or Skip rows are focused (was blank).
- **Empty-state error** on search (reserved word, invalid slug) shows a structured inline hint instead of an empty list.
- **Empty-DB path** — picker now opens with the Create row and Skip option so a fresh install can bootstrap from the terminal. Previously the picker exited with "could not reach API" even when the server was fine and just had no collections yet.

### Fixed
- **`NewCollectionModal` and inline `CollectionPicker`** no longer swallow 4xx API errors as "offline" — they surface the real message, keep the modal/dropdown open, and skip the localStorage ghost write that would otherwise pollute the meta cache forever.
- **`install.sh` surfaces port conflicts** with the holding PID + process name + two copy-paste fixes, pre-flight (before the 2-3 min build). Previously the script silently exited after "Images built" if a port was busy.
- **`install.sh` captures compose output** on failure with heuristic hints (bind-address, daemon unreachable).
- **Picker rendering collision bug** — the synthetic Create row no longer double-draws the `(Recommended)` suffix, no longer renders a stray `0` count, and no longer bleeds text into the right panel.
- **Skip row focus clamp** — the cursor can now actually land on the pinned Skip row (was being snapped back to the last list item on every render tick).

### Migrated
- Alembic `0012_slugify_collection_names` runs automatically on API startup; no operator intervention required. Existing seed collections (`Conventions`, `DevOps`, `Official`) aligned to lowercase slugs in `seed_data.py`.

## [0.3.1] - 2026-04-15

### Fixed
- Empty collections created in the web UI now appear in the CLI collection picker (`skillnote-pick`). Previously they were only written to browser localStorage and invisible to the backend.

### Added
- `collections` table with full CRUD: `POST/PUT/DELETE /v1/collections`. `DELETE` is refused with 409 when any skill still references the collection.
- Auto-migration: existing `skillnote:collections-meta` localStorage entries are POSTed to the API on first load of `/collections`, then cleared from localStorage on success.

### Changed
- `GET /v1/collections` response now includes `description` field (additive, backwards-compatible).

## [0.3.0] - 2026-04-08

### Added
- **Claude Code Plugin** — one-command install (`curl | bash`) with auto-sync, analytics, and skill creation
- **Collection Picker** — full-screen curses TUI at every `claude` launch with search, two-column preview, Clawd × SkillNote branding
- **Status Line** — persistent `● S K I L L N O T E │ Collection │ Skills │ URL` at bottom of Claude Code
- **6 Hook Events** — SessionStart (sync), FileChanged (instant sync), PostToolUse (HTTP analytics), PostCompact (context re-injection), SubagentStart (context injection), Stop (skill-push suggestion)
- **Skill Catalog Injection** — SessionStart injects skill names + descriptions into Claude's context so skills trigger automatically
- **Skill Usage Confirmation** — PostToolUse shows "Using skillnote-X from Collection" when a skill fires
- **`/skillnote` Dashboard** — one command to see active collection, skills, URLs, commands
- **`/skillnote:skill-push`** — create new skills from conversations
- **Output Style** — SkillNote-branded response style for Claude Code
- **15-Skill Cap** — collections limited to 15 skills for optimal context budget
- **Connect Page** — rewritten from MCP configs to a clean Claude Code setup page with feature grid and getting started steps
- **Branded Sync Splash** — `✦ S K I L L N O T E` with skill card box after every sync
- **`skillnote-` Prefix** — all synced skills use `skillnote-{slug}` for grouped autocomplete
- **Collection Descriptions** — skill descriptions prefixed with collection name in autocomplete

### Changed
- **Claude Code Only** — removed support for Cursor, OpenHands, Codex, Universal agents (will return later)
- **MCP Removed from Plugin** — skills delivered via sync hooks, not MCP tools
- **Collections Required** — every skill must belong to at least one collection
- **Sidebar** — "MCP Integrations" renamed to "Connect"
- **Settings** — "MCP Tools" renamed to "Agent Tools"
- **Analytics** — "via MCP" references replaced with "by AI agents"
- **Install Paths** — show Claude Code only with `skillnote-{slug}` prefix
- **Setup Output** — clean branded box + getting started steps (no redundant info)

### Fixed
- 36+ bugs across picker, sync, hooks, analytics, and setup
- Session eval data corruption (was storing in wrong DB column)
- SQL injection in analytics `days` parameter (now parameterized)
- Shell injection via Host header in setup script
- Generic 500 handler (no more stack trace leaks)
- CORS now respects config (was hardcoded `*`)
- Separator/box alignment at all terminal widths
- Silent failures throughout — every error now shows a message

## [0.2.0] - 2026-03-08

### Added
- Dynamic app versioning — version sourced from `package.json`, displayed in sidebar and settings
- `CHANGELOG.md` for tracking releases

### Fixed
- Port collision on startup — `install.sh` now ensures ports are fully released before launching containers
- `.gitignore` rewritten with proper entries for Next.js, Python, env files, and build artifacts

## [0.1.0] - 2026-03-07

### Added
- Skill rating and completion tracking via `complete_skill` MCP tool
- Settings page with MCP tool toggles (completion tracking, outcome field)
- Settings API backend (`/v1/settings`)

## [0.0.9] - 2026-03-06

### Added
- Analytics dashboard with recharts visualizations and usage trends
- Real-time `notifications/tools/list_changed` for MCP clients

## [0.0.8] - 2026-03-05

### Fixed
- MCP session recovery after server restart without requiring reconnect
- Tooltip portal and grid layout stability
- Session overflow, copy reliability, chip truncation bugs

## [0.0.7] - 2026-03-04

### Added
- MCP Integrations page with live connection tracking and agent identity
- Rich connection identity and scalable 100+ connection UI
- CLI install command row for agents that support it
- Collection scope context in live connections panel

### Fixed
- Session stays visible with 30min timeout + pre-create on initialize
- Copy buttons work on non-HTTPS LAN origins

## [0.0.6] - 2026-03-03

### Added
- Collection UX overhaul — Notion-style design, inline confirm, smart picker
- Collection membership shown on skill list and detail views
- Inline remove confirmation in AddSkillsModal

### Changed
- Removed tags system, replaced with skills-to-collection UI
- Dropped tags from SQLAlchemy ORM models to match DB schema

## [0.0.5] - 2026-03-02

### Added
- MCP server exposing skills as tools (`/mcp` endpoint)
- MCP service added to Docker Compose stack
- Full E2E and unit test suite for MCP server

## [0.0.4] - 2026-03-01

### Added
- SKILL.md import/export with YAML frontmatter
- Content versioning with set-latest and restore
- Editor UX — sticky toolbar, raw SKILL.md frontmatter, version transition dialog
- Comprehensive E2E tests for import flow

### Fixed
- Frontmatter duplication and version tracking bugs
- Import race condition, title parsing, tag expansion

## [0.0.3] - 2026-02-28

### Added
- Redesigned home page with editorial-style skill discovery
- Redesigned skill detail page with hero header and field labels
- User profile and created-by attribution on skills
- Version info display in skill editor with save confirmation popup

## [0.0.2] - 2026-02-27

### Added
- Full backend API — skills CRUD, comments, tags, content versioning
- Offline-first state management with localStorage + API sync
- Connection status banner for unconfigured/offline states
- New Skill modal with keyboard shortcut (`N`)
- Delete Skill with confirmation dialog
- Docker Compose deployment (postgres, api, web)
- CLI tool with agent adapters (Claude, Cursor, Codex, OpenHands)
- Publish pipeline with bundle validation and checksummed ZIPs

### Fixed
- Comment visibility, swipe guard, auth/offline distinction

## [0.0.1] - 2026-02-26

### Added
- Initial release — SkillNote self-hosted skill registry
- Next.js frontend with App Router, Tailwind CSS, shadcn/ui
- FastAPI backend with SQLAlchemy, Alembic migrations
- PostgreSQL database with skill, version, and comment models
- Dark/light theme with system default
- Command palette with keyboard shortcuts
