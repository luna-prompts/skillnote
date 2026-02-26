# SkillNote — Production-Ready Design

**Date:** 2026-02-26
**Author:** Rudra Naik
**Scope:** Fix all 32 bugs + implement all missing features found during E2E audit

---

## Background

E2E Playwright audit found 32 issues across frontend and backend:
- 3 critical (New Skill no-op, RSC abort, UI/backend data mismatch)
- 5 high (comment submit noop, tag Rename/Delete noop, disabled buttons, no 404 shell)
- 6 medium (collection slug casing, mobile tags hidden, fake presence, broken links, reset wipes skills)
- 14 missing features (backend config, skill deletion, comment persistence, etc.)

---

## Approach: Layered Milestones (Option B)

5 ordered layers, each independently committable and deployable.

---

## Layer 1 — Infrastructure

### Problem
65 RSC (`?_rsc=...`) prefetch requests abort in production Docker build, degrading client-side navigation.

### Fix
- Add `output: 'standalone'` to `next.config.ts`
- Update `Dockerfile` to use the standalone build pattern (copy `.next/standalone`, `.next/static`, `public`)
- Ensure streaming-safe response headers are not stripped by Docker layer

### Files
- `next.config.ts`
- `Dockerfile`

---

## Layer 2 — Data Layer

### Problems
1. `toSkill()` sets `content_md = description` (skill content lost)
2. Hardcoded `'skn_dev_demo_token'` in production `api/client.ts`
3. No UI to configure API URL or token
4. Silent API failures — no user feedback
5. `syncSkillsFromApi()` overwrites localStorage with no merge

### Fixes

**`src/lib/api/skills.ts`**
- Add `fetchSkill(slug)` → `GET /v1/skills/{slug}` for full detail
- Fix `toSkill()` to not clobber `content_md` with description

**`src/lib/api/client.ts`**
- Remove hardcoded demo token fallback
- Read API base URL from `localStorage['skillnote:api-url']` with env var fallback

**`src/lib/skills-store.ts`**
- On API failure: keep cache, return cached skills, emit an offline event
- Add `getConnectionStatus()` helper

**`src/app/(app)/settings/page.tsx` — new "Backend" section**
- API URL input field
- Token input (masked)
- "Test Connection" button → `POST /auth/validate-token` → shows ✓ Connected / ✗ Failed

**Connection banner**
- Small non-blocking toast when backend unreachable: "Backend unreachable — showing cached data"

---

## Layer 3 — Core CRUD (Frontend)

### New Skill Modal (`src/components/skills/NewSkillModal.tsx`)
- Triggered by "New Skill" button (topbar desktop + mobile FAB)
- Fields: Title (required), Description, Tags (chip input), Collection (select)
- On confirm: `slugify(title)` → `addSkill()` → `POST /v1/skills` (if connected) → `router.push(/skills/{slug})`
- Keyboard shortcut: `N` on home page

### Delete Skill
- New "Delete" item in `⋯` More menu in `skill-detail.tsx`
- Confirmation dialog
- On confirm: `deleteSkill(slug)` + `DELETE /v1/skills/{slug}` + `router.push('/')`

### Collection Create (`src/components/collections/NewCollectionModal.tsx`)
- "New Collection" button wired (un-disabled)
- Fields: Name, Description, Color (from existing `COLLECTION_COLORS`)
- Stored in `localStorage['skillnote:collections-meta']` — shown in list even before skills assigned
- Collections remain derived from skill `collections[]` arrays; metadata is additive

### Tag Rename/Delete (`src/app/(app)/tags/page.tsx`)
- Rename: opens inline input (replace badge with `<input>`) + confirm → updates all skills with that tag → `PATCH /v1/tags/{name}`
- Delete: confirmation modal → removes tag from all skills → `DELETE /v1/tags/{name}`

---

## Layer 4 — Backend API Extensions

### New Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/v1/skills/{slug}` | Full skill detail |
| `POST` | `/v1/skills` | Create skill |
| `DELETE` | `/v1/skills/{slug}` | Delete skill |
| `PATCH` | `/v1/skills/{slug}` | Update skill (title, description, tags, collections, content) |
| `GET` | `/v1/skills/{slug}/comments` | List comments |
| `POST` | `/v1/skills/{slug}/comments` | Add comment |
| `PATCH` | `/v1/skills/{slug}/comments/{id}` | Edit comment |
| `DELETE` | `/v1/skills/{slug}/comments/{id}` | Delete comment |
| `GET` | `/v1/tags` | List all tags with skill counts |
| `PATCH` | `/v1/tags/{name}` | Rename tag (updates all skills) |
| `DELETE` | `/v1/tags/{name}` | Remove tag from all skills |

### DB Changes
- Add `comments` table: `id` (uuid pk), `skill_id` (fk), `author` (text), `body` (text), `created_at` (timestamptz)
- Add `content_md` column to `skills` table (text, nullable)
- Add `tags` and `collections` columns to `skills` table (text arrays)
- New Alembic migration

### Auth
- All write endpoints require valid Bearer token (existing middleware)
- Read endpoints (`GET /v1/skills/{slug}`, `GET /v1/skills/{slug}/comments`) also require auth

### Files
- `backend/app/api/skills.py` (extend)
- `backend/app/api/comments.py` (new)
- `backend/app/api/tags.py` (new)
- `backend/app/db/models/skill.py` (add content_md, tags, collections columns)
- `backend/app/db/models/comment.py` (new)
- `backend/alembic/versions/0002_skill_content_and_comments.py` (new migration)
- `backend/app/schemas/comment.py` (new)

---

## Layer 5 — UI Polish

### 404 Page (`src/app/(app)/not-found.tsx`)
- Add sidebar + topbar shell
- Branded "Page not found" with icon + "Go to Skills" button

### Mobile Tags
- Add mobile card list below `sm` breakpoint as fallback to the hidden table

### Remove Fake Presence
- Replace hardcoded Pat/Rudra/Tyler avatars with `skill.updated_at` + "Last edited" chip
- Remove `mockTeamMembers` import from `skill-detail.tsx`

### Settings Links
- Wire "View on GitHub" → `https://github.com/luna-prompts/skillnote`
- Wire "Documentation" → same URL or remove if no docs exist

### Reset Fix (`settings/page.tsx`)
- Replace `localStorage.clear()` with targeted key removal (preserve `skillnote:skills`, only clear preference keys)

### Comment Submit
- Wire `onSubmit` prop to `CommentInput` in `SkillViewTab`
- Clear textarea on submit
- Call `POST /v1/skills/{slug}/comments`
- Show toast on success/failure

### History Empty State
- When `revisions.length === 0`: show "No revision history yet" state with icon instead of blank

### Offline Banner
- `src/components/layout/connection-banner.tsx`
- Shows when `getConnectionStatus() === 'offline'`
- Dismissable

### Keyboard Shortcut
- `N` on home/list pages → open New Skill modal

---

## Data Flow (Post-Fix)

```
Browser → GET /v1/skills → backend → localStorage cache
       → GET /v1/skills/{slug} → full skill (content_md, tags, collections)
       → POST /v1/skills → create → localStorage update
       → DELETE /v1/skills/{slug} → delete → localStorage update
       → POST /v1/skills/{slug}/comments → comment persisted
```

If backend unreachable: show offline banner, serve from localStorage cache.

---

## Security

- Token stored in localStorage (accepted risk for v1, noted for future improvement)
- Remove hardcoded `skn_dev_demo_token` from production bundle
- All write operations require token validation

---

## Definition of Done

- [ ] New Skill modal creates skills and navigates to detail
- [ ] Delete skill works end-to-end
- [ ] Comments submit and persist to backend
- [ ] Tag rename/delete updates all affected skills
- [ ] Collection create works
- [ ] Backend config (URL + token) in Settings with connection test
- [ ] RSC prefetch errors gone (verified via Playwright network log)
- [ ] UI shows backend skills, not mock data
- [ ] 404 page has app shell
- [ ] Mobile tags has fallback view
- [ ] No fake presence avatars
- [ ] Settings links go somewhere real
- [ ] Reset does not wipe skills cache
- [ ] Offline banner appears when backend unreachable
