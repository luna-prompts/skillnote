# Collection Picker — Create / Skip / Recommendation Options

**Date:** 2026-04-17
**Branch:** `feat/collection-picker-options`
**Author:** Atharva (via brainstorming session)
**Status:** Design approved; pending implementation plan

---

## Problem

The current collection picker (`plugin/bin/skillnote-pick`) lets a user pick one of the existing collections as the active skill set for a project. It lacks three options that users need at project startup:

1. **Create new** — if none of the existing collections fit, the user has no way to create one inline.
2. **Skip** — no explicit way to opt out; pressing `esc` preserves the current selection instead of clearing it, so "run Claude with no SkillNote skills" is not reachable from the picker.
3. **Recommendation for unknown projects** — when the current working directory does not match any existing collection, the picker does not suggest creating one named after the project.

This spec adds all three, and tightens collection-name validation to keep the registry's naming scheme consistent.

## Goals

- Let the user create a collection without leaving the picker.
- Let the user opt out of collections entirely.
- Suggest a project-named collection (either existing or new) based on the working directory.
- Lock down collection naming to `^[a-z0-9_-]+$` everywhere (picker, web UI, backend), and migrate existing names to match.

## Non-Goals

- Multi-select in the terminal picker — stays single-select (web `/collections/pick` page remains multi-select separately).
- Replacing the `AskUserQuestion`-based `/skillnote:collection` slash command with a different mechanism. It gets parity updates, not a rewrite.
- Changes to the web `/collections/pick` multi-select page.
- Fuzzy/partial matching of folder names against collections — only case-insensitive exact match.
- Concurrent-picker coordination.

## Touch Points

### Primary (picker UX)

- **`plugin/bin/skillnote-pick`** — main curses picker and `pick_fallback` non-tty fallback.
  - Replace `★` marker with `(Recommended)` bracketed label (Claude-Code native style).
  - Add dynamic `+ Create 'X'` row (surfaced when the search query is a valid slug and does not match any existing collection; also surfaced as the top row when `basename(cwd)` produces a valid slug with no existing match).
  - Add pinned `⊘ Skip (Ctrl+K)` row below the scrollable list area, always visible.
  - Bind `Ctrl+K` as Skip hotkey.
  - Add Skip confirmation modal.
  - Add name-conflict mini-prompt for Create collisions.

- **`plugin/skills/collection/SKILL.md`** — slash-command picker (AskUserQuestion-based).
  - Add `Create new collection…` option (when chosen, skill asks user to type a name in a follow-up text turn; validates against the shared rule and POSTs to `/v1/collections`; on 409 reuses the existing collection).
  - Add `Skip (use no collections)` option (when chosen, writes `{"collections": []}` and runs sync). No confirmation prompt here — AskUserQuestion itself is already a deliberate selection step, so adding a second prompt would be noise.
  - For the recommended collection, append ` · Recommended` to its existing `description` field (which today carries `"{count} skills"`). Result: `"12 skills · Recommended"`. No reordering needed; AskUserQuestion lists options in the order given, so the skill places the recommended option first.
  - No `Ctrl+K` or hotkeys here — hotkeys are a curses-only concern. The slash command is a pure multiple-choice UI.

### Validation

- **`backend/app/validators/collection_validator.py`** — add regex rule `^[a-z0-9_-]+$` and reserved-word check (`anthropic`, `claude`, matching `src/lib/skill-validation.ts:7`) alongside existing length/newline/XML checks. This validator is already wired into `POST /v1/collections` via `backend/app/schemas/collection.py:19-25`, so no schema change needed there.
- **`backend/app/schemas/skill.py`** — add a `field_validator` on `SkillCreate.collections` / `SkillUpdate.collections` that runs each entry through `validate_collection_name`. Closes the skill-push path that currently lets arbitrary strings land in `skills.collections[]`.
- **`src/lib/collection-validation.ts`** (new) — mirror backend rule for frontend use; export `validateCollectionName`, `normalizeCollectionName`, `slugFromCollectionName` following the pattern in `src/lib/skill-validation.ts`.
- **`src/components/collections/NewCollectionModal.tsx`** — wire validator; show inline error and disable Create button when invalid.
- **`src/components/collections/CollectionPicker.tsx`** — gate `canCreate` on slug validity; disable `+ Create 'X'` row when query fails validation. Also apply validation to the offline-fallback write at lines 37-42 so local state cannot drift from backend rules.
- **`plugin/skills/skill-push/SKILL.md`** — update Step 4 to instruct the user that new collection names must match `^[a-z0-9_-]+$`. Informational guidance only; the backend `SkillCreate` validator is the actual enforcement point.

### Migration

- **`backend/alembic/versions/0012_slugify_collection_names.py`** (new) — `revision = '0012_slugify_collection_names'`, `down_revision = '0011_collections_table'`. Slugifies all existing collection names and updates all skill records' embedded `collections` arrays.

### Tests

- `backend/tests/unit/test_collection_validator.py` (**extend** — file already exists) — add regex + reserved-word cases.
- `backend/tests/integration/test_migration_0012_slugify.py` (new) — seeded migration run + idempotency + collision test.
- `plugin/tests/test_skillnote_pick_helpers.py` (new) — pure-function unit tests for `_slugify`, `_is_valid_slug`, `_resolve_recommendation`.
- `e2e/collection-validation.spec.ts` (new) — Playwright coverage for New Collection modal + inline CollectionPicker create path.

Frontend unit tests for the pure validator are intentionally omitted — `package.json` does not ship `vitest`/`jest`, and the Playwright e2e proves the same behavior without introducing a new test framework for a 10-line regex.

## User Flow (Terminal Picker)

### Startup

1. `skillnote-pick` runs pre-`claude`, fetches `GET /v1/collections`.
2. Computes `folder_raw = basename(cwd)` and `folder_slug = slugify(folder_raw)` (same algorithm as the migration).
3. Classifies into one of three recommendation states:
   - **Match:** `folder_raw.lower()` equals an existing collection name (case-insensitive) → that row gets `(Recommended)` label and sorts to top.
   - **Create-suggestion:** no match, but `folder_slug` is non-empty → top row becomes `+ Create '{folder_slug}' (Recommended)`. Display uses the slugified form so the suggested name is always valid.
   - **None:** no match and `folder_slug` is empty → no recommendation; list shows existing collections only.

### Interactions

| Action | Effect |
|---|---|
| Type in search box | Filters existing collections by case-insensitive substring match on name. Separately, if the filtered list is empty **and** `slugify(query)` is non-empty **and** no existing collection name equals `slugify(query)`, append `+ Create '{slugify(query)}'` row. Example: user types `My App` → filter shows nothing → create row shows `+ Create 'my-app'`. |
| Enter on existing collection | Write `{"collections": [name]}` to `.skillnote.json`; run sync; exit. |
| Enter on `+ Create 'X'` | POST `/v1/collections` with name=X. On success → write `.skillnote.json`, run sync, exit. On 409 conflict → show inline Y/N prompt *"'X' already exists with N skills. Activate it? [Y/N]"*. Y → activate existing; N → return to search with query preserved. |
| Enter on pinned Skip row OR `Ctrl+K` | Show confirmation modal *"Are you sure you want to skip?"* with `[Y] Yes [N] Cancel`. Y/Enter → write `{"collections": []}`, clean `.claude/skills/`, exit. N/Esc → dismiss, return to picker. |
| Esc on picker | Cancel; `.skillnote.json` unchanged. |

### Layout

```
  ┌ type to search... ┐

  ❯ 1. frontend (Recommended)  12
    2. backend                  8
    3. devops                   3
    … scrolls for longer lists …

  ─────
    ⊘ Skip (Ctrl+K)
    ↑/↓ navigate · ↵ select · esc cancel
```

Skip is always visible regardless of list length. Recommended collection (or `+ Create '{folder}' (Recommended)` row when no match) sorts to the top of the list area.

### Fallback (non-curses) picker

`pick_fallback()` gets equivalent options as plain numbered input:

```
  ✦ S K I L L N O T E — Pick a collection

    1. frontend  (Recommended)  12 skills
    2. backend                   8 skills
    3. devops                    3 skills
    C. Create new collection
    S. Skip (use no collections)

  > _
```

- Numeric input selects a collection.
- `C` followed by a name on next prompt → create flow.
- `S` → Skip, with the same confirmation phrasing (`Are you sure you want to skip? [Y/N]`).

## Validation Rules

Single shared rule across backend, frontend, and picker:

- Pattern: `^[a-z0-9_-]+$`
- Length: 1–128 characters (after trim)
- Reserved words (blocked as substrings): `anthropic`, `claude` — matches `src/lib/skill-validation.ts:7`
- Existing checks retained: no newlines, no XML tags (defense-in-depth)

### Enforcement sites

| Site | Behavior |
|---|---|
| `backend/app/validators/collection_validator.py` | Return error list; POST `/v1/collections` returns 400 with message when rule fails. |
| `src/lib/collection-validation.ts` (new) | Pure function, mirror of backend. |
| `NewCollectionModal.tsx` | Inline error below input (`AlertCircle` + red text matching the existing `nameError` pattern at `NewCollectionModal.tsx:91-96`); Create button disabled while invalid. |
| `CollectionPicker.tsx` (inline web picker) | `canCreate` memo gated on slug validity; `+ Create 'X'` option hidden when invalid. |
| `skillnote-pick` (curses) | The `+ Create 'X'` row is displayed only when the condition in the User Flow table holds (filter empty, `slugify(query)` non-empty, no existing match). Invalid queries produce no row and no popup — silent. The displayed name is always the slugified form. |

## Slugify Migration (`0012_slugify_collection_names.py`)

### Algorithm

```
slug(name) =
  lowercase →
  replace runs of [^a-z0-9_-]+ with "-" →
  collapse consecutive "-" →
  strip leading/trailing "-" →
  truncate to 128 chars
```

Empty result (e.g. `"!!!"` → `""`) falls back to `collection-{hash8}` where `{hash8}` is the first 8 hex chars of `sha1(original_name)`. The `collections` table uses `name` as its primary key (`backend/app/db/models/collection.py:12`) — there is no surrogate `id` column to fall back on. Hash-based suffix is deterministic, collision-safe in practice, and preserves migration reproducibility.

### Collision resolution

When two different names normalize to the same slug, append `-2`, `-3`, etc. Ordering is deterministic:

- Primary: ascending `created_at`
- Tiebreaker: ascending original name

Example: `[Frontend, "frontend-", frontend_]` (created in that order) → `[frontend, frontend-2, frontend-3]`.

### Steps

1. Inside a single transaction:
   1. SELECT all distinct collection names from `collections` table + from skills' embedded `collections` arrays.
   2. Build rename map `{old_name → new_slug}`, resolving collisions.
   3. `UPDATE collections SET name = new_slug` for each changed entry. Because `name` is the primary key and `ix_collections_name_ci` enforces case-insensitive uniqueness (added in `0011_collections_table.py:25`), updates must be ordered so that no intermediate state violates the index. Simplest approach: apply all renames via a single `UPDATE ... FROM (VALUES ...) AS map` statement that Postgres executes atomically.
   4. For each skill whose `collections` array contains any renamed name, rewrite that array (also via a single set-based UPDATE using `array_replace` chained per rename pair, or a procedural loop if simpler).
2. Commit.

### Properties

- **Idempotent:** if all names already satisfy the regex, rename map is empty and migration is a no-op.
- **Downgrade:** `pass` (no-op). Original casing/punctuation cannot be recovered without a pre-migration stash; documented.
- **Partial failure:** the transaction prevents partial state; Alembic rolls back cleanly.

## Error Handling

| Failure | Handling |
|---|---|
| API unreachable at picker start | Preserve current behavior: stderr `"could not reach API at http://{host}:8082"`, exit without picker. |
| API unreachable during Create | Curses: one-line toast `"Create failed — API unreachable. Press any key."` at bottom; return to search with query preserved. Web New Collection modal: existing offline fallback (local-only save) retained for non-picker flows. |
| Invalid slug in picker query | `+ Create 'X'` row hidden silently. No popup. |
| Invalid slug in web modal / picker | Inline error under input; Create button disabled. |
| 409 name conflict on create | Inline Y/N prompt (see user flow). Y activates existing, N returns to search with query preserved. |
| `.skillnote.json` write fails (EACCES) | Preserve current `PermissionError` branch in both Skip and normal-pick paths. |
| Sync script failure | Preserve current silent exit. Next `claude` launch retries. |
| Migration interrupted mid-run | Single transaction ensures rollback; no partial rename state. |
| Migration produces empty slug | Fallback `collection-{id}`, WARN-level log entry during migration for operator audit. |
| Skip when already on empty collection | Confirm modal still shown; confirm is a no-op exit. No special branch. |
| Concurrent pickers on same project | Last-writer-wins on `.skillnote.json`. No locking. |

## Testing

### Backend (pytest)

- `backend/tests/unit/test_collection_validator.py` (**extend** — file already exists):
  - Valid: `frontend`, `my-app_2`, `a`, 128-char boundary.
  - Invalid: `Frontend`, `my app`, `foo!`, empty, 129-char, names containing reserved words (`anthropic`, `claude`), newline/XML (preserved).
- `backend/tests/integration/test_migration_0012_slugify.py` (new):
  - `test_basic_slugify` — seed `[Frontend, "lp assessment", my-app, "!!!"]` + skills referencing them → run migration → assert names become `[frontend, lp-assessment, my-app, collection-{hash8}]` and all skill records updated.
  - `test_collision_resolution` — seed `[Frontend, "frontend-", frontend_]` in order → assert `[frontend, frontend-2, frontend-3]`.
  - `test_idempotent` — run twice; second run changes nothing.
  - `test_skill_references_updated` — skills whose `collections` arrays contain old names get rewritten to new names.

### Frontend

- `e2e/collection-validation.spec.ts` (new) — Playwright: New Collection modal rejects `Frontend`, accepts `frontend`; picker's inline create path follows same rules; offline-fallback write also rejects invalid names.

No frontend unit tests — `package.json` does not ship `vitest`/`jest`, and Playwright e2e proves the same regex behavior without introducing a new test framework.

### Picker (Python helpers only)

Extract pure helpers into `plugin/bin/skillnote-pick` (exposed for import):
- `_slugify(name) -> str`
- `_is_valid_slug(name) -> bool`
- `_resolve_recommendation(folder, existing) -> Literal['pick', 'create', 'none'], idx_or_slug`

`plugin/tests/test_skillnote_pick_helpers.py` unit-tests these. Curses rendering is not tested automatically.

### Manual QA (documented, not automated)

- `/skillnote:collection` slash command: verify Create and Skip options appear; verify Skip clears `.skillnote.json`.
- Terminal picker: resize terminal below `COMPACT_THRESHOLD` (70 cols) and verify Skip row stays visible.
- Skip confirmation modal: verify Y and Enter both confirm; N and Esc both dismiss.

## Out of Scope

- Curses rendering pixel-perfection.
- Cross-platform terminal sizing edge cases beyond what `skillnote-pick` handles today.
- Retroactive rename notification to users (migration just runs on deploy).
- Multi-project `.skillnote.json` templates.

## Open Questions

None. All UX and implementation questions resolved during brainstorming.

## Success Criteria

- User can start `claude` in a new project directory, see a `+ Create '{folder}' (Recommended)` row at the top of the picker, press Enter, and have a matching collection created and activated without leaving the terminal.
- User can press `Ctrl+K` (or navigate to the pinned Skip row), confirm the modal, and have `.skillnote.json` written with `{"collections": []}` and all local skills cleaned.
- `POST /v1/collections` with name `Frontend` returns a 400 with a clear validation message; `frontend` succeeds.
- After migration, every collection name in the database matches `^[a-z0-9_-]+$`, and all skill records reference the post-migration names.
- Running the migration twice is a no-op on the second run.
