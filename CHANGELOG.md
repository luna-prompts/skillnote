# Changelog

All notable changes to SkillNote will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## 0.3.1 — 2026-04-15

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
