# Repository map: skillnote

## Purpose

Skill registry with Next.js frontend, FastAPI backend, and a separate Node/TypeScript CLI.

## Change-specific focus

Keep frontend/backend skill validation and offline-sync behavior aligned. Use master as the current base branch. Do not publish CLI packages, containers, or tap releases during ordinary validation.

## Validation commands

Run checks only after installing the component dependencies from its committed lockfile and configuring isolated test resources. These are command references, not a claim that application tests were run for this configuration-only change.

### .

Source: `package.json`. Inspect the script before execution; some builds generate files or require services.

- `npm run build` — `next build`
- `npm run lint` — `eslint`

### cli

Source: `cli/package.json`. Inspect the script before execution; some builds generate files or require services.

- `npm run build` — `tsup && node scripts/copy-assets.mjs`
- `npm run test` — `vitest run`
- `npm run test:e2e` — `vitest run tests/e2e`
- `npm run lint` — `biome check src tests`
- `npm run typecheck` — `tsc --noEmit`

- Backend: from `backend/`, run selected `pytest` tests with a local test database; integration tests may contact an API.

### Agent configuration (all repositories)

```sh
sh scripts/luna-agents.sh sync
sh scripts/luna-agents.sh sync --check
sh scripts/luna-agents.sh doctor
```
