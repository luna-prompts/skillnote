# Production Hardening Spec

## Goal
Run 10 iterative hardening rounds. Each round is a self-contained session that ends with a clean commit. The codebase should be measurably more production-ready after every round.

## Tech stack
- **Frontend**: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Tiptap · shadcn/ui · lucide-react · sonner · next-themes
- **Backend**: Python 3.12 · FastAPI · SQLAlchemy 2 (Mapped style) · Alembic · Pydantic 2 · pydantic-settings
- **Database**: PostgreSQL 16
- **CLI**: Node.js · TypeScript · Commander.js
- **Infra**: Docker · Docker Compose (postgres + api + web)
- **Tests**: pytest (backend, `backend/tests/`) · Playwright (e2e, `e2e/`) · vitest (CLI, `cli/src/__tests__/`)
- **State**: localStorage + module-level pub/sub (no Redux/Zustand/Context)
- **API URL resolution**: `localStorage['skillnote:api-url']` → `NEXT_PUBLIC_API_BASE_URL` → `http://localhost:8082`

## New functionality (extra scrutiny zone)
Recently shipped Connect feature + PWA install affordance — the hot zone for regressions:

- `src/app/(app)/integrations/page.tsx` — Connect page (state machine, polling, modal mounts)
- `src/components/integrations/` — all integration components:
  - `connect-modal.tsx` — install flow (confirm → starting → running → success/error states)
  - `disconnect-modal.tsx` — destructive confirmation
  - `agent-list-row.tsx`, `agent-card.tsx` — Browse + Connected surfaces
  - `action-panel.tsx`, `connection-diagram.tsx`, `connector.tsx`, `product-card.tsx`, `agent-marks.tsx`
- `src/lib/cli-jobs.ts` — `dispatchJob` + `useJobPolling` (bridge daemon contract)
- `src/lib/use-pwa-install.ts` — shared PWA install hook (module-level event cache)
- `src/components/PWAInstallPrompt.tsx` — floating prompt
- `src/components/InstallAppRow.tsx` — Settings row driving the same hook
- `src/app/(app)/settings/page.tsx` — slimmed Settings page
- `backend/app/api/setup.py` — install scripts, `POST /v1/setup/installs`, `GET /v1/setup/agents`, `DELETE /v1/setup/installs/{agent}`, state derivation
- `backend/app/db/models/agent_install.py` — `agent_installs` table
- `backend/alembic/versions/0017_agent_installs.py` — migration
- `e2e/integrations-page.spec.ts` — Playwright coverage of the Connect flow

## Per-round checklist
Each round must complete ALL of the following before commit:

1. **Full traversal** — every route, every page, every user flow. None skipped.
2. **Three-surface bug hunt:**
   - Code: logic errors, edge cases, race conditions, error handling gaps, unhandled states
   - UI/UX: layout breaks, spacing, responsiveness, a11y, confusing flows — verify against actual rendered screenshots via Playwright
   - Component richness: thin components elevated with proper empty states, loading states, micro-interactions
3. **Nuke testing** — push every flow to failure: invalid inputs, network failures, concurrency, large datasets, rapid clicks, back-button abuse, stale sessions
4. **Code quality** — performance (rendering, queries, bundle, memoization), scalable architecture (no tight coupling, no hardcoded limits), consistent design system (no one-off styles)
5. **Tests added for everything touched:** unit, component, integration, e2e, visual regression
6. **Extra scrutiny on new functionality** (paths listed above)
7. **All findings fixed before commit**
8. **Round summary** appended to `docs/HARDENING_LOG.md`: bugs found, fixes applied, tests added, what improved

## Reporting rules (critical)
Report every issue found — including ones you're uncertain about or consider low-severity. Do not filter for importance at discovery time. A separate verification pass will filter. Suppressing low-severity findings here loses signal permanently.

## Commit discipline
- One commit per round, conventional commits format
- Round number in commit message: `chore(hardening): round N — <summary>`
- `docs/HARDENING_LOG.md` updated in the same commit
