# SkillNote UI — Mock Removal & Backend Integration Plan

## Context
Backend milestones (A–E) are now live for:
- auth token validation
- skills list + versions
- bundle download
- publish pipeline
- security hardening

UI still uses `mock-data` + `localStorage` in multiple routes/components. This creates drift: users see demo values even when backend state changes.

---

## Current UI Mock Dependencies (audit)

## High-impact mock coupling
- `src/lib/skills-store.ts` → seeds from `mockSkills` and persists in localStorage
- `src/lib/export-utils.ts` → exports `mockSkills` (not live data)
- `src/app/(app)/page.tsx` → tag/collection filter UI tied to `mockTags/mockCollections`
- `src/components/layout/sidebar.tsx` → static counts from mock constants
- `src/components/layout/topbar.tsx` → collection name resolution from mock constants
- `src/app/(app)/settings/page.tsx` → export counts from mock values

## Additional mock usage (phase 2 cleanup)
- collection pages (`/collections`, `/collections/[slug]`)
- tags pages (`/tags`)
- history page under `/skills/[slug]/history`
- tab components that rely on mock comments/revisions/team members

---

## Goal
Move UI to backend-driven state while preserving UX:
1) no false/demo counts in primary navigation
2) list/detail/export reflect real backend data
3) clear fallback behavior for unauthenticated/offline states

---

## Proposed Integration Architecture

## 1) API client layer (single source of truth)
Create:
- `src/lib/api/client.ts`
- `src/lib/api/skills.ts`

Responsibilities:
- base URL from env (`NEXT_PUBLIC_API_BASE_URL`)
- bearer token injection from local config
- normalized error mapping from backend contract (`error.code`, `error.message`)
- typed response interfaces for skills/versions/download/publish

## 2) Auth/session config in UI
Add lightweight config store:
- host URL
- token
- validation status (via `/auth/validate-token`)

Storage:
- localStorage acceptable for now (Phase 1)
- move to secure storage approach later if desktop wrapper/extension added

## 3) Data hooks
Add hooks:
- `useSkillsList`
- `useSkillVersions(skillSlug)`
- `usePublishSkill`
- `useDownloadSkillVersion`

Use SWR or React Query for caching/revalidation.

---

## Implementation Phases (UI)

## Phase UI-1 (must-do now)
Replace core mock usage in main flow.

### Changes
1. `src/lib/skills-store.ts`
- stop seeding from `mockSkills`
- replace with API-backed fetch + optional optimistic local cache
- keep localStorage only as cache/fallback (not source of truth)

2. `src/lib/export-utils.ts`
- export from live fetched skills (or per-skill backend download), not `mockSkills`

3. `src/app/(app)/page.tsx`
- load skills from API
- compute tags/collections from live skills instead of `mockTags/mockCollections`

4. `src/components/layout/sidebar.tsx`
- counts from live data
- loading skeleton for counts

5. `src/components/layout/topbar.tsx`
- remove mock collection resolution; resolve from API-derived map

6. `src/app/(app)/settings/page.tsx`
- export count from live data source

### Acceptance criteria
- Skills list matches backend exactly
- sidebar counts update after publish/import
- export uses real skills
- no reference to `mockSkills` in main skill list flow

---

## Phase UI-2 (secondary)
Clean remaining mock pages/components.

### Targets
- collections pages
- tags pages
- history page
- comments/revisions attachments tabs (move to backend fields or hide until supported)

### Acceptance criteria
- no user-visible hardcoded demo dataset
- unsupported tabs show explicit “coming from backend soon” state

---

## Required Backend/UI Contract Notes

To unblock richer UI features later:
- add `GET /v1/skills/{skill}` detail endpoint (optional but useful)
- add `GET /v1/skills/{skill}/history` when revision model lands
- add tags/collections in backend model if they must be first-class (currently frontend-derived)

---

## Risks & Mitigations

1. **Token handling in browser**
- Risk: token leakage in logs/devtools screenshots
- Mitigation: never log token; redact in client error handling

2. **UI assumes fields backend doesn’t provide yet**
- Risk: null access, broken tabs
- Mitigation: typed guards + feature flags + graceful empty states

3. **Mixed source-of-truth (mock + API)**
- Risk: inconsistent counts/data
- Mitigation: phase order ensures primary routes migrate first

---

## Suggested Next Commit Order (UI)

1. Add API client + env config + typed models
2. Migrate `skills-store` + home page + sidebar + topbar
3. Migrate export path
4. Add integration tests for UI data loading states
5. Clean remaining mock references in phase UI-2

---

## Test Plan (UI)

## Unit
- API error mapping (structured backend errors)
- live tag/collection derivation from skills list

## Integration
- home page renders real skills from mocked API server
- sidebar counts reflect API response
- settings export count reflects API data

## E2E
- login token config -> list skills -> publish from backend -> UI refresh shows new skill

---

## Success Definition
UI no longer presents mock/demo data in core user journey (list, counts, export, details) and behaves as a true frontend for the SkillNote backend.
