# CLAUDE.md

> Project guide for AI coding agents working on SkillNote.

## Overview

SkillNote is a self-hosted skill registry for AI coding agents. It lets teams create, version, and distribute `SKILL.md` files across Claude Code, Cursor, Codex, OpenHands, and more. The app is offline-first: skills are stored in localStorage and sync to PostgreSQL when the backend is available.

## Tech Stack

| Layer    | Technology                                                    |
| -------- | ------------------------------------------------------------- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4, Tiptap     |
| Backend  | Python 3.12, FastAPI, SQLAlchemy 2, Alembic, Pydantic 2      |
| Database | PostgreSQL 16                                                 |
| CLI      | Node.js, TypeScript, Commander.js                             |
| Infra    | Docker, Docker Compose                                        |

## Project Structure

```
skillnote/
├── src/                          # Next.js frontend (App Router)
│   ├── app/(app)/                # Route group: pages (home, skills, tags, collections, settings)
│   ├── components/
│   │   ├── skills/               # SkillDetail, SkillCard, editor, tabs (view/edit/history/comments)
│   │   ├── layout/               # Sidebar, TopBar, ConnectionBanner
│   │   ├── import/               # ImportModal (SKILL.md file import)
│   │   └── ui/                   # shadcn/ui primitives
│   └── lib/
│       ├── api/client.ts         # Fetch wrapper (apiRequest<T>) + SkillNoteApiError
│       ├── api/skills.ts         # All typed API calls (CRUD, comments, tags, versions)
│       ├── skills-store.ts       # Offline-first state (localStorage + API sync)
│       ├── skill-validation.ts   # Frontend validation (mirrors backend rules exactly)
│       ├── mock-data.ts          # TypeScript types + seed data
│       ├── markdown-utils.ts     # SKILL.md generation + parsing with YAML frontmatter
│       ├── hooks.ts              # useKeyboardShortcut, useClipboard, useLocalStorage
│       └── utils.ts              # cn() (clsx + tailwind-merge)
├── backend/                      # FastAPI backend
│   ├── app/api/                  # Route handlers (skills, comments, tags, publish, downloads)
│   ├── app/db/models/            # SQLAlchemy models (Skill, SkillVersion, SkillContentVersion, Comment)
│   ├── app/schemas/              # Pydantic request/response schemas
│   ├── app/validators/           # skill_validator.py (name/desc rules), bundle_validator.py (ZIP validation)
│   ├── app/core/config.py        # pydantic-settings with SKILLNOTE_ env prefix
│   ├── app/services/             # LocalBundleStorage (ZIP file storage)
│   ├── alembic/versions/         # 4 migrations (initial → rich fields → content versions → drop auth)
│   ├── tests/                    # pytest unit + integration tests
│   └── scripts/                  # seed_data.py, wait_for_db.py, smoke_test.sh
├── cli/                          # CLI tool (skillnote binary)
│   └── src/
│       ├── commands/             # login, list, add, check, update, remove, doctor
│       └── agents/               # Agent adapters (claude, cursor, codex, openclaw, openhands, universal)
├── e2e/                          # Playwright E2E tests
├── docker-compose.yml            # Full stack: postgres + api + web
└── Dockerfile                    # Next.js multi-stage build
```

## Git Workflow

The `master` branch is protected. All changes must go through a feature branch and a pull request. Never push directly to `master`.

1. Create a feature branch (`git checkout -b feat/my-feature`)
2. Commit changes to the feature branch
3. Push the branch and create a PR (`gh pr create`)
4. Merge after approval

## Development Setup

### Full stack with Docker

```bash
docker compose up --build -d
# Web: http://localhost:3000  |  API: http://localhost:8082
```

### Frontend hot-reload

```bash
docker compose up --build -d postgres api    # Backend in Docker
npm install && npm run dev                   # Frontend on localhost:3000
```

### LAN access

```bash
SKILLNOTE_HOST=192.168.1.100 docker compose up --build -d
```

## Key Architectural Patterns

### State Management (No Library)

Skills state lives in `localStorage` under `skillnote:skills`. No Redux, Zustand, or Context.

- `getSkills()` / `writeStorage()` read/write localStorage directly
- Cross-component sync via `window.dispatchEvent(new Event('skillnote:skills-changed'))`
- Home page re-syncs on: mount, 30s interval, window focus, `skillnote:skills-changed` event
- Connection status is a module-level pub/sub (`_connectionStatus` + `_listeners`)

### Offline-First Pattern

1. Render immediately from localStorage (no loading flash)
2. `syncSkillsFromApi()` merges API + local-only skills in the background
3. Create/update: try API first, fall back to local with version increment
4. Delete: API required (no offline delete)
5. `ConnectionBanner` shows when offline with retry button

### API Call Chain

```
Components → skills-store.ts → api/skills.ts → api/client.ts (apiRequest<T>)
```

Components never call API directly (except comments and tags).

### API URL Resolution

Priority: `localStorage['skillnote:api-url']` > `NEXT_PUBLIC_API_BASE_URL` env > `http://localhost:8082`

### Validation (Mirrored Frontend/Backend)

Both sides enforce identical rules:
- **Name**: max 64 chars, pattern `^[a-z0-9-]+$`, no reserved words (`anthropic`, `claude`)
- **Description**: max 1024 chars, non-empty
- Frontend: `src/lib/skill-validation.ts`
- Backend: `backend/app/validators/skill_validator.py`

### Content Versioning

Every save creates a `SkillContentVersion` snapshot (auto-incremented integer). Users can browse history, compare, and restore any version. Published versions use semver and are distributed as checksummed ZIP bundles.

## Authentication

**Currently: No authentication.** Auth tables were dropped in migration 0004. All API endpoints are open. The `TODO: Re-enable when ACL is ready` comments mark where auth will return.

## Coding Conventions

### Frontend
- Use `cn()` from `@/lib/utils` for conditional class names
- All pages are client components (`'use client'`)
- Icons: `lucide-react` only
- UI primitives: shadcn/ui in `src/components/ui/`
- Styling: Tailwind CSS 4, CSS variables for theming (defined in `globals.css`)
- Fonts: DM Sans (body) + JetBrains Mono (code)
- Toast notifications: `sonner`
- Theme: `next-themes` with system default

### Backend
- All errors return `{"error": {"code": "...", "message": "..."}}` via the global exception handler
- Config via `pydantic-settings` with `SKILLNOTE_` prefix
- DB sessions: `get_db()` dependency injection
- Models use `Mapped` columns (SQLAlchemy 2.0 style)
- Schemas use `from_attributes=True` for ORM compatibility

### File Naming
- React components: PascalCase (`SkillEditTab.tsx`, `NewSkillModal.tsx`)
- Lib modules: kebab-case (`skills-store.ts`, `skill-validation.ts`)
- Backend: snake_case (`skill_validator.py`, `storage_service.py`)

## Testing

| Layer    | Framework  | Location              | Run Command                    |
| -------- | ---------- | --------------------- | ------------------------------ |
| Backend  | pytest     | `backend/tests/`      | `cd backend && pytest`         |
| Frontend | Playwright | `e2e/`                | `npx playwright test`          |
| CLI      | vitest     | `cli/src/__tests__/`  | `cd cli && npm test`           |

- E2E tests mock all `/v1/**` API calls via `page.route()` so they run without a backend
- Backend integration tests hit the live API (skip if unreachable)

## Docker

- `docker-compose.yml`: 3 services (postgres, api, web)
- Backend auto-runs: `wait_for_db.py` → `alembic upgrade head` → `seed_data.py` → `uvicorn`
- `NEXT_PUBLIC_API_BASE_URL` is a Docker build arg (baked at build time)
- Frontend uses `output: 'standalone'` for minimal production image

## Important Files

| File | Purpose |
| ---- | ------- |
| `src/components/skills/skill-detail.tsx` | Largest component: tabs, command palette, keyboard shortcuts, swipe nav |
| `src/lib/skills-store.ts` | Core state module: localStorage CRUD + API sync + offline fallback |
| `src/lib/api/client.ts` | Base `apiRequest<T>()` fetch wrapper |
| `src/lib/skill-validation.ts` | Frontend validation rules |
| `backend/app/api/skills.py` | Main CRUD + versioning endpoints |
| `backend/app/validators/skill_validator.py` | Name/description validation |
| `backend/app/validators/bundle_validator.py` | ZIP upload validation (path traversal, size limits, frontmatter) |
| `backend/app/core/config.py` | All env vars with defaults |

## Versioning

App version is the single source of truth in `package.json` (`"version": "x.y.z"`).

- **`next.config.ts`** reads `package.json` and exposes `NEXT_PUBLIC_APP_VERSION` at build time
- **Sidebar footer** displays the version next to the connection status indicator
- **Settings page** shows the version in the About section and a collapsible Changelog
- **`CHANGELOG.md`** in the project root documents all releases
- **`CHANGELOG_ENTRIES`** array in `src/app/(app)/settings/page.tsx` mirrors the changelog for in-app display

When bumping the version:
1. Update `"version"` in `package.json`
2. Add a new entry to `CHANGELOG.md`
3. Add a new entry to `CHANGELOG_ENTRIES` in `src/app/(app)/settings/page.tsx`

## SKILL.md Format

```markdown
---
name: my-skill
description: What it does and when to trigger it.
---

# My Skill

Instructions for the AI agent...
```

## Keyboard Shortcuts

| Key | Action | Context |
| --- | ------ | ------- |
| `N` | New skill | Home |
| `Cmd/Ctrl+K` | Command palette / search | Anywhere |
| `Cmd/Ctrl+S` | Save | Editor |
| `E` | Edit | Skill detail |
| `Escape` | Close / go back | Anywhere |
