# Collection Picker Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Create / Skip / (Recommended) options to the terminal collection picker, lock down collection-name validation to `^[a-z0-9_-]+$`, and migrate existing names to match.

**Architecture:** Backend-first — tighten the shared validator and ship the slugify migration before any UI work. Picker changes extract pure helpers (testable) and keep curses rendering logic separate. Per-name validation on `/v1/skills` lives in the handler (after `canonicalize_collection_names`) to preserve case-tolerance for clients.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic (backend); Next.js 16, React 19, TypeScript (web); Python curses (terminal picker); pytest, Playwright (tests).

**Spec:** `docs/superpowers/specs/2026-04-17-collection-picker-options-design.md`

---

## File Structure

| Path | Responsibility | Action |
|---|---|---|
| `backend/app/validators/collection_validator.py` | Shared name-validation rule (regex + reserved + length/newline/XML) | Modify |
| `backend/tests/unit/test_collection_validator.py` | Unit tests for the above | Extend |
| `backend/alembic/versions/0012_slugify_collection_names.py` | One-time rename of existing collection names + skill references | Create |
| `backend/tests/integration/test_migration_0012_slugify.py` | Integration tests for the migration | Create |
| `backend/app/api/skills.py` | Add post-canonicalize per-name validation on create/update | Modify |
| `backend/tests/integration/test_skills_api.py` | Tests for the new handler-level validation | Create |
| `src/lib/collection-validation.ts` | Frontend mirror of validator (pure function) | Create |
| `src/components/collections/NewCollectionModal.tsx` | Wire validator into Create modal | Modify |
| `src/components/collections/CollectionPicker.tsx` | Gate `canCreate` on slug validity | Modify |
| `e2e/collection-validation.spec.ts` | Playwright coverage for name validation | Create |
| `plugin/bin/skillnote-pick` | Extract pure helpers + add `(Recommended)` label + Skip row + Ctrl+K + create flow | Modify |
| `plugin/tests/test_skillnote_pick_helpers.py` | Unit tests for extracted helpers | Create |
| `plugin/skills/collection/SKILL.md` | Add Create / Skip options + `(Recommended)` description | Modify |
| `plugin/skills/skill-push/SKILL.md` | Informational guidance on collection-name rule | Modify |

---

## Task 1: Extend collection-name validator with regex + reserved words

**Files:**
- Modify: `backend/app/validators/collection_validator.py`
- Test: `backend/tests/unit/test_collection_validator.py`

- [ ] **Step 1: Write the failing tests**

Open `backend/tests/unit/test_collection_validator.py` and add these cases (file already exists — extend, don't replace):

```python
# Add near existing tests
import pytest
from app.validators.collection_validator import validate_collection_name


def test_valid_slug_lowercase_hyphens_underscores_digits():
    assert validate_collection_name("frontend") == []
    assert validate_collection_name("my-app_2") == []
    assert validate_collection_name("a") == []
    assert validate_collection_name("a" * 128) == []


def test_rejects_uppercase():
    errs = validate_collection_name("Frontend")
    assert any("lowercase" in e.lower() or "letters, numbers" in e for e in errs)


def test_rejects_space():
    errs = validate_collection_name("my app")
    assert len(errs) >= 1


def test_rejects_special_chars():
    errs = validate_collection_name("foo!")
    assert len(errs) >= 1


def test_rejects_over_128_chars():
    errs = validate_collection_name("a" * 129)
    assert any("128" in e for e in errs)


def test_rejects_reserved_words():
    assert any("anthropic" in e for e in validate_collection_name("anthropic-stuff"))
    assert any("claude" in e for e in validate_collection_name("claude-code"))


def test_empty_is_rejected():
    assert validate_collection_name("") != []
    assert validate_collection_name("   ") != []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && pytest tests/unit/test_collection_validator.py -v
```

Expected: multiple failures (the new regex/reserved-word checks don't exist yet).

- [ ] **Step 3: Implement the new rules**

Replace the contents of `backend/app/validators/collection_validator.py` with:

```python
import re

from app.validators.skill_validator import RESERVED_WORDS

COLLECTION_NAME_MAX = 128
NAME_PATTERN = re.compile(r"^[a-z0-9_-]+$")
XML_TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")


def validate_collection_name(name: str) -> list[str]:
    errors: list[str] = []
    if name is None:
        errors.append("Collection name is required")
        return errors
    stripped = name.strip()
    if not stripped:
        errors.append("Collection name is required")
        return errors
    if len(stripped) > COLLECTION_NAME_MAX:
        errors.append(f"Collection name must be {COLLECTION_NAME_MAX} characters or fewer")
    if "\n" in stripped or "\r" in stripped:
        errors.append("Collection name cannot contain newlines")
    if not NAME_PATTERN.match(stripped):
        errors.append("Collection name must contain only lowercase letters, numbers, hyphens, and underscores")
    for word in RESERVED_WORDS:
        if word in stripped:
            errors.append(f'Collection name cannot contain reserved word "{word}"')
    if XML_TAG_RE.search(stripped):
        errors.append("Collection name cannot contain XML tags")
    return errors
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && pytest tests/unit/test_collection_validator.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/validators/collection_validator.py backend/tests/unit/test_collection_validator.py
git commit -m "feat(backend): tighten collection-name validation to [a-z0-9_-]+ with reserved words"
```

---

## Task 2: Create frontend validator mirror

**Files:**
- Create: `src/lib/collection-validation.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/lib/collection-validation.ts
// Mirror of backend/app/validators/collection_validator.py

export const COLLECTION_NAME_MAX = 128

const NAME_PATTERN = /^[a-z0-9_-]+$/
const RESERVED_WORDS = ['anthropic', 'claude']
const XML_TAG_RE = /<\/?[a-zA-Z][^>]*>/

export type ValidationError = { field: string; message: string }

export function validateCollectionName(name: string): ValidationError[] {
  const errors: ValidationError[] = []
  if (!name || !name.trim()) {
    errors.push({ field: 'name', message: 'Name is required' })
    return errors
  }
  const stripped = name.trim()
  if (stripped.length > COLLECTION_NAME_MAX) {
    errors.push({ field: 'name', message: `Name must be ${COLLECTION_NAME_MAX} characters or fewer` })
  }
  if (!NAME_PATTERN.test(stripped)) {
    errors.push({ field: 'name', message: 'Only lowercase letters, numbers, hyphens, and underscores allowed' })
  }
  for (const word of RESERVED_WORDS) {
    if (stripped.includes(word)) {
      errors.push({ field: 'name', message: `Name cannot contain reserved word "${word}"` })
    }
  }
  if (XML_TAG_RE.test(stripped)) {
    errors.push({ field: 'name', message: 'Name cannot contain XML tags' })
  }
  return errors
}

/** Slugify algorithm — shared with the slugify migration + picker's folder-suggestion. */
export function slugifyCollectionName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')   // runs of invalid → single hyphen
    .replace(/-+/g, '-')              // collapse consecutive hyphens
    .replace(/^-|-$/g, '')            // strip leading/trailing hyphens
    .slice(0, COLLECTION_NAME_MAX)
}

export function isValidCollectionSlug(s: string): boolean {
  return validateCollectionName(s).length === 0
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors related to the new file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/collection-validation.ts
git commit -m "feat(frontend): add collection-name validator + slugify helper (mirrors backend)"
```

---

## Task 3: Slugify migration for existing collection names

**Files:**
- Create: `backend/alembic/versions/0012_slugify_collection_names.py`
- Test: `backend/tests/integration/test_migration_0012_slugify.py`

- [ ] **Step 1a: Write the failing algorithm unit test**

This codebase doesn't have an `alembic upgrade`-running test harness — integration tests hit a live API via urllib. The important logic in the migration is the pure Python slugifier + collision resolver. Cover that with a unit test of the migration module's helpers.

Create `backend/tests/unit/test_migration_0012_slugify_algorithm.py`:

```python
"""Unit tests for the slugify algorithm used by migration 0012.

We import the private helpers from the migration module and exercise them
directly, so we don't need a running DB to validate the naming logic.
"""
import importlib.util
import hashlib
from pathlib import Path


def _load():
    path = (
        Path(__file__).resolve().parents[2]
        / "alembic" / "versions" / "0012_slugify_collection_names.py"
    )
    spec = importlib.util.spec_from_file_location("m0012", path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_slugify_basic():
    m = _load()
    assert m._slugify("Frontend") == "frontend"
    assert m._slugify("lp assessment") == "lp-assessment"
    assert m._slugify("my-app") == "my-app"
    assert m._slugify("!!!") == ""


def test_slugify_collapses_and_strips():
    m = _load()
    assert m._slugify("   --Foo!!Bar--") == "foo-bar"


def test_fallback_uses_hash8():
    m = _load()
    expected = f"collection-{hashlib.sha1(b'!!!').hexdigest()[:8]}"
    assert m._fallback("!!!") == expected


def test_fallback_deterministic():
    m = _load()
    assert m._fallback("xyz") == m._fallback("xyz")
```

- [ ] **Step 1b: Write the failing migration-behavior integration test**

The integration-test pattern in this repo hits a live API. Create a smoke test that relies on `docker compose up` having run the migration, and verifies the post-migration state via the API:

Create `backend/tests/integration/test_migration_0012_slugify.py`:

```python
"""Post-migration smoke test for 0012.

Verifies that after the backend starts (which runs `alembic upgrade head`
per the Dockerfile), every collection name returned by /v1/collections
matches the new regex. Skips if API unreachable.
"""
import json
import os
import re
import urllib.error
import urllib.request

import pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
NAME_PATTERN = re.compile(r"^[a-z0-9_-]+$")


def _get_collections():
    try:
        with urllib.request.urlopen(f"{BASE_URL}/v1/collections") as r:
            return json.loads(r.read())
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def test_all_collection_names_are_valid_slugs():
    cols = _get_collections()
    bad = [c["name"] for c in cols if not NAME_PATTERN.match(c["name"])]
    assert not bad, f"Non-slug collection names still present after migration: {bad}"


def test_collection_names_are_bounded():
    cols = _get_collections()
    over = [c["name"] for c in cols if len(c["name"]) > 128]
    assert not over, f"Names over 128 chars: {over}"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && pytest tests/unit/test_migration_0012_slugify_algorithm.py -v
```

Expected: import fails (migration file doesn't exist yet). The integration test will skip without a running API — that's fine; we'll run it after Step 3.

- [ ] **Step 3: Implement the migration**

Create `backend/alembic/versions/0012_slugify_collection_names.py`:

```python
"""slugify collection names

Revision ID: 0012_slugify_collection_names
Revises: 0011_collections_table
Create Date: 2026-04-18
"""
import hashlib
import re

from alembic import op
import sqlalchemy as sa

revision = '0012_slugify_collection_names'
down_revision = '0011_collections_table'
branch_labels = None
depends_on = None


NAME_PATTERN = re.compile(r"^[a-z0-9_-]+$")
MAX_LEN = 128


def _slugify(name: str) -> str:
    s = name.lower()
    s = re.sub(r"[^a-z0-9_-]+", "-", s)
    s = re.sub(r"-+", "-", s)
    s = s.strip("-")
    return s[:MAX_LEN]


def _fallback(original: str) -> str:
    return f"collection-{hashlib.sha1(original.encode('utf-8')).hexdigest()[:8]}"


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Gather every distinct collection name (union of collections table + skills embedded arrays)
    rows = conn.execute(sa.text(
        """
        SELECT name, created_at FROM (
            SELECT name, created_at FROM collections
            UNION
            SELECT DISTINCT unnest(collections) AS name, now() AS created_at
            FROM skills
            WHERE collections IS NOT NULL AND collections != '{}'
        ) u
        ORDER BY created_at, name
        """
    )).all()

    # 2. Build the rename map with collision resolution
    rename: dict[str, str] = {}
    used: set[str] = set()
    for name, _created in rows:
        if NAME_PATTERN.match(name) and len(name) <= MAX_LEN:
            used.add(name)
            continue
        candidate = _slugify(name) or _fallback(name)
        if candidate in used:
            base = candidate
            i = 2
            while f"{base}-{i}" in used:
                i += 1
            candidate = f"{base}-{i}"
        rename[name] = candidate
        used.add(candidate)

    if not rename:
        return  # idempotent no-op

    # 3. Rename collections table rows atomically using a VALUES-based UPDATE
    pairs = list(rename.items())
    values_sql = ", ".join(f"(:old_{i}, :new_{i})" for i in range(len(pairs)))
    params = {}
    for i, (old, new) in enumerate(pairs):
        params[f"old_{i}"] = old
        params[f"new_{i}"] = new
    conn.execute(sa.text(
        f"UPDATE collections SET name = m.new_name, updated_at = now() "
        f"FROM (VALUES {values_sql}) AS m(old_name, new_name) "
        f"WHERE collections.name = m.old_name"
    ), params)

    # 4. Rewrite skill.collections arrays — apply each rename pair
    for old, new in pairs:
        conn.execute(sa.text(
            "UPDATE skills SET collections = array_replace(collections, :old, :new) "
            "WHERE :old = ANY(collections)"
        ), {"old": old, "new": new})


def downgrade() -> None:
    # Cannot recover original casing/punctuation without a pre-migration stash
    pass
```

- [ ] **Step 4: Run algorithm tests to verify they pass**

```bash
cd backend && pytest tests/unit/test_migration_0012_slugify_algorithm.py -v
```

Expected: all four pass.

- [ ] **Step 5: Apply the migration to a dev DB and run the post-migration smoke test**

```bash
docker compose up --build -d postgres api
# API startup runs `alembic upgrade head` automatically
cd backend && pytest tests/integration/test_migration_0012_slugify.py -v
```

Expected: both integration tests pass (or skip if API not reachable — run `docker compose logs api` to confirm `alembic upgrade` ran).

- [ ] **Step 6: Commit**

```bash
git add backend/alembic/versions/0012_slugify_collection_names.py \
        backend/tests/unit/test_migration_0012_slugify_algorithm.py \
        backend/tests/integration/test_migration_0012_slugify.py
git commit -m "feat(backend): add migration 0012 to slugify existing collection names"
```

---

## Task 4: Handler-level validation on `POST /v1/skills`

**Files:**
- Modify: `backend/app/api/skills.py` (around line 305)
- Test: `backend/tests/integration/test_skills_api.py` (create new)

- [ ] **Step 1: Write the failing tests**

Integration tests in this repo hit a live API via urllib (see `backend/tests/integration/test_collections_api.py` for the pattern). The global exception handler wraps `HTTPException.detail` as `{"error": {...}}`, so assertions check `body["error"]["code"]` (confirmed by `test_collections_api.py:77`).

Create `backend/tests/integration/test_skills_api.py`:

```python
"""Integration tests for skill-create/update collection-name validation.

Requires a running backend on 127.0.0.1:8082 (`docker compose up api`).
Tests skip if API unreachable.
"""
import json
import os
import urllib.error
import urllib.request
import uuid

import pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _request(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        method=method,
        headers={"Content-Type": "application/json"} if body else {},
        data=(json.dumps(body).encode() if body is not None else None),
    )
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode()
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        return e.code, json.loads(text) if text else None
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


@pytest.fixture
def seed_collection():
    name = "frontend"
    _request("POST", "/v1/collections", {"name": name, "description": ""})  # ignore 409 if already exists
    yield name


@pytest.fixture
def unique_skill_slug():
    return f"test-skill-{uuid.uuid4().hex[:8]}"


def _skill_payload(slug: str, collections: list[str]):
    return {
        "name": slug,
        "slug": slug,
        "description": "validation test skill",
        "content_md": "",
        "collections": collections,
    }


def test_create_skill_rejects_invalid_collection_name(seed_collection, unique_skill_slug):
    status, body = _request("POST", "/v1/skills", _skill_payload(unique_skill_slug, ["Bad Name"]))
    assert status == 422
    assert body["error"]["code"] == "COLLECTION_NAME_INVALID"


def test_create_skill_accepts_canonicalizable_variant(seed_collection, unique_skill_slug):
    status, body = _request("POST", "/v1/skills", _skill_payload(unique_skill_slug, ["Frontend"]))
    assert status == 201, body
    assert body["collections"] == ["frontend"]
    _request("DELETE", f"/v1/skills/{unique_skill_slug}")


def test_update_skill_rejects_invalid_collection_name(seed_collection, unique_skill_slug):
    status, _ = _request("POST", "/v1/skills", _skill_payload(unique_skill_slug, ["frontend"]))
    assert status == 201
    status, body = _request(
        "PATCH", f"/v1/skills/{unique_skill_slug}", {"collections": ["Bad Name"]}
    )
    assert status == 422
    assert body["error"]["code"] == "COLLECTION_NAME_INVALID"
    _request("DELETE", f"/v1/skills/{unique_skill_slug}")
```

- [ ] **Step 2: Run tests to verify they fail**

Make sure a backend is up: `docker compose up --build -d postgres api`.

```bash
cd backend && pytest tests/integration/test_skills_api.py -v
```

Expected: `test_create_skill_rejects_invalid_collection_name` fails (handler does not reject invalid names yet). `test_create_skill_accepts_canonicalizable_variant` passes (today's permissive behavior). The update test is covered in Task 5.

- [ ] **Step 3: Add validation to the create_skill handler**

In `backend/app/api/skills.py`, find the `create_skill` function (around line 295). Change the section that calls `canonicalize_collection_names` (around line 305) from:

```python
    # Canonicalize: map case variants to existing stored forms, de-duplicate
    canonical_collections = canonicalize_collection_names(db, payload.collections or [])

    # Check collection skill-count limits
    for col_name in canonical_collections:
        err = validate_collection_skill_count(db, col_name)
        if err:
            raise api_error(422, "COLLECTION_LIMIT_REACHED", err)
```

to:

```python
    # Canonicalize: map case variants to existing stored forms, de-duplicate
    canonical_collections = canonicalize_collection_names(db, payload.collections or [])

    # Validate each canonical name against the shared collection-name rule
    for col_name in canonical_collections:
        name_errs = validate_collection_name(col_name)
        if name_errs:
            raise api_error(422, "COLLECTION_NAME_INVALID",
                            f'Collection "{col_name}": {"; ".join(name_errs)}')

    # Check collection skill-count limits
    for col_name in canonical_collections:
        err = validate_collection_skill_count(db, col_name)
        if err:
            raise api_error(422, "COLLECTION_LIMIT_REACHED", err)
```

Add the new import at the top of `backend/app/api/skills.py` (near the existing validator imports, around line 17):

```python
from app.validators.collection_validator import validate_collection_name
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && pytest tests/integration/test_skills_api.py::test_create_skill_rejects_invalid_collection_name \
                        tests/integration/test_skills_api.py::test_create_skill_accepts_canonicalizable_variant -v
```

Expected: both pass. (Third test still fails — handled in next task.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/skills.py backend/tests/integration/test_skills_api.py
git commit -m "feat(backend): validate collection names in POST /v1/skills after canonicalize"
```

---

## Task 5: Handler-level validation on `PATCH /v1/skills/{slug}`

**Files:**
- Modify: `backend/app/api/skills.py` (around line 369-379)

- [ ] **Step 1: Re-run the previously failing test**

```bash
cd backend && pytest tests/integration/test_skills_api.py::test_update_skill_rejects_invalid_collection_name -v
```

Expected: fails.

- [ ] **Step 2: Add validation to the update_skill handler**

In `backend/app/api/skills.py`, find `update_skill` (around line 348). Change the collections-handling block (around line 369-379) from:

```python
    if payload.collections is not None:
        # Canonicalize incoming names to stored case + de-duplicate variants
        canonical_collections = canonicalize_collection_names(db, payload.collections)
        # Check skill-count limits for any newly added collections (case-insensitive)
        current_lower = {c.lower() for c in (skill_row.collections or [])}
        for col_name in canonical_collections:
            if col_name.lower() not in current_lower:
                err = validate_collection_skill_count(db, col_name, exclude_skill_id=skill_row.id)
                if err:
                    raise api_error(422, "COLLECTION_LIMIT_REACHED", err)
        skill_row.collections = canonical_collections
```

to:

```python
    if payload.collections is not None:
        # Canonicalize incoming names to stored case + de-duplicate variants
        canonical_collections = canonicalize_collection_names(db, payload.collections)
        # Validate each canonical name against the shared rule
        for col_name in canonical_collections:
            name_errs = validate_collection_name(col_name)
            if name_errs:
                raise api_error(422, "COLLECTION_NAME_INVALID",
                                f'Collection "{col_name}": {"; ".join(name_errs)}')
        # Check skill-count limits for any newly added collections (case-insensitive)
        current_lower = {c.lower() for c in (skill_row.collections or [])}
        for col_name in canonical_collections:
            if col_name.lower() not in current_lower:
                err = validate_collection_skill_count(db, col_name, exclude_skill_id=skill_row.id)
                if err:
                    raise api_error(422, "COLLECTION_LIMIT_REACHED", err)
        skill_row.collections = canonical_collections
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
cd backend && pytest tests/integration/test_skills_api.py -v
```

Expected: all three tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/skills.py
git commit -m "feat(backend): validate collection names in PATCH /v1/skills/{slug} after canonicalize"
```

---

## Task 6: Wire validator into `NewCollectionModal.tsx`

**Files:**
- Modify: `src/components/collections/NewCollectionModal.tsx`

- [ ] **Step 1: Import the validator + wire into onChange**

Open `src/components/collections/NewCollectionModal.tsx`. Add this import near the top (after the existing `createCollectionApi` import at line 6):

```tsx
import { validateCollectionName } from '@/lib/collection-validation'
```

Replace the `onChange` handler on the name input (around line 84) and the `handleCreate` function's name check (around line 25) so validation fires on input and on submit.

Find this line (line 84):
```tsx
              onChange={e => { setName(e.target.value); if (nameError) setNameError('') }}
```

Replace with:
```tsx
              onChange={e => {
                setName(e.target.value)
                const errs = validateCollectionName(e.target.value)
                setNameError(errs[0]?.message ?? '')
              }}
```

Find this block (around line 24-26 inside `handleCreate`):
```tsx
  async function handleCreate() {
    if (!name.trim()) { setNameError('Name is required'); nameRef.current?.focus(); return }
    setNameError('')
```

Replace with:
```tsx
  async function handleCreate() {
    const errs = validateCollectionName(name)
    if (errs.length > 0) {
      setNameError(errs[0].message)
      nameRef.current?.focus()
      return
    }
    setNameError('')
```

- [ ] **Step 2: Disable Create button while invalid**

Find the Create button (around line 119-127). Change:

```tsx
          <Button
            size="sm"
            className="h-8 text-[13px] gap-1.5 bg-foreground text-background hover:bg-foreground/90"
            disabled={!name.trim() || saving}
            onClick={handleCreate}
          >
```

To:

```tsx
          <Button
            size="sm"
            className="h-8 text-[13px] gap-1.5 bg-foreground text-background hover:bg-foreground/90"
            disabled={!name.trim() || saving || validateCollectionName(name).length > 0}
            onClick={handleCreate}
          >
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Smoke test manually (optional but recommended)**

```bash
docker compose up --build -d postgres api
npm run dev
```

Visit `http://localhost:3000/collections`, click New Collection, type `Frontend` → inline error should appear, button disabled. Type `frontend` → accepts, button enabled.

- [ ] **Step 5: Commit**

```bash
git add src/components/collections/NewCollectionModal.tsx
git commit -m "feat(frontend): wire collection-name validator into NewCollectionModal"
```

---

## Task 7: Gate `canCreate` in `CollectionPicker.tsx` on slug validity

**Files:**
- Modify: `src/components/collections/CollectionPicker.tsx` (around line 87-92)

- [ ] **Step 1: Import the validator**

Add import near the top (after line 5):

```tsx
import { isValidCollectionSlug } from '@/lib/collection-validation'
```

- [ ] **Step 2: Gate `canCreate`**

Find the `canCreate` memo at line 87-92:

```tsx
  const canCreate = useMemo(() => {
    const v = query.trim()
    if (!v) return false
    return !allCollections.some(c => c.toLowerCase() === v.toLowerCase()) &&
           !selected.some(c => c.toLowerCase() === v.toLowerCase())
  }, [query, allCollections, selected])
```

Replace with:

```tsx
  const canCreate = useMemo(() => {
    const v = query.trim()
    if (!v) return false
    if (!isValidCollectionSlug(v)) return false
    return !allCollections.some(c => c.toLowerCase() === v.toLowerCase()) &&
           !selected.some(c => c.toLowerCase() === v.toLowerCase())
  }, [query, allCollections, selected])
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/collections/CollectionPicker.tsx
git commit -m "feat(frontend): gate inline Create on slug validity in CollectionPicker"
```

---

## Task 8: Playwright e2e coverage for name validation

**Files:**
- Create: `e2e/collection-validation.spec.ts`

- [ ] **Step 1: Write the Playwright spec**

Create `e2e/collection-validation.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

test.describe('Collection name validation', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the collections list
    await page.route('**/v1/collections', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ name: 'frontend', count: 0, description: '' }]),
      })
    })
  })

  test('NewCollectionModal rejects uppercase names', async ({ page }) => {
    await page.goto('/collections')
    await page.getByRole('button', { name: /new collection/i }).first().click()
    const name = page.getByPlaceholder(/e\.g\./i)
    await name.fill('Frontend')
    await expect(page.getByText(/lowercase/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /^create$/i })).toBeDisabled()
  })

  test('NewCollectionModal accepts lowercase slug', async ({ page }) => {
    await page.route('**/v1/collections', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            name: 'devops', description: '',
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }),
        })
      } else {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify([{ name: 'frontend', count: 0, description: '' }]),
        })
      }
    })

    await page.goto('/collections')
    await page.getByRole('button', { name: /new collection/i }).first().click()
    const name = page.getByPlaceholder(/e\.g\./i)
    await name.fill('devops')
    await expect(page.getByRole('button', { name: /^create$/i })).toBeEnabled()
  })

  test('NewCollectionModal rejects reserved word', async ({ page }) => {
    await page.goto('/collections')
    await page.getByRole('button', { name: /new collection/i }).first().click()
    const name = page.getByPlaceholder(/e\.g\./i)
    await name.fill('claude-stuff')
    await expect(page.getByText(/reserved word/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /^create$/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run the Playwright tests**

```bash
npx playwright test e2e/collection-validation.spec.ts
```

Expected: all three tests pass. If the test can't find the `/collections` page or the "New Collection" button, check the web UI; selectors may need adjustment based on the actual DOM.

- [ ] **Step 3: Commit**

```bash
git add e2e/collection-validation.spec.ts
git commit -m "test(e2e): playwright coverage for collection-name validation"
```

---

## Task 9: Extract pure helpers in `skillnote-pick`

**Files:**
- Modify: `plugin/bin/skillnote-pick` (add helpers near top)
- Create: `plugin/tests/test_skillnote_pick_helpers.py`

- [ ] **Step 1: Write the failing tests**

Create `plugin/tests/test_skillnote_pick_helpers.py`:

```python
"""Unit tests for pure helpers in skillnote-pick."""
import importlib.util
import sys
from pathlib import Path


def _load_module():
    path = Path(__file__).resolve().parents[1] / "bin" / "skillnote-pick"
    spec = importlib.util.spec_from_file_location("skillnote_pick", path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_slugify_lowercases():
    m = _load_module()
    assert m._slugify("Frontend") == "frontend"


def test_slugify_replaces_spaces():
    m = _load_module()
    assert m._slugify("My App") == "my-app"


def test_slugify_collapses_and_strips():
    m = _load_module()
    assert m._slugify("  --My!!!App-- ") == "my-app"


def test_slugify_returns_empty_for_all_invalid():
    m = _load_module()
    assert m._slugify("!!!") == ""


def test_is_valid_slug():
    m = _load_module()
    assert m._is_valid_slug("frontend") is True
    assert m._is_valid_slug("my-app_2") is True
    assert m._is_valid_slug("My App") is False
    assert m._is_valid_slug("") is False
    assert m._is_valid_slug("claude-stuff") is False  # reserved word


def test_resolve_recommendation_match():
    m = _load_module()
    existing = [("frontend", 5, []), ("backend", 3, [])]
    assert m._resolve_recommendation("Frontend", existing) == ("pick", 0)


def test_resolve_recommendation_create():
    m = _load_module()
    existing = [("frontend", 5, [])]
    assert m._resolve_recommendation("My App", existing) == ("create", "my-app")


def test_resolve_recommendation_none():
    m = _load_module()
    existing = [("frontend", 5, [])]
    assert m._resolve_recommendation("!!!", existing) == ("none", None)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd plugin && python -m pytest tests/test_skillnote_pick_helpers.py -v
```

Expected: all helpers missing → fails.

- [ ] **Step 3: Add the helpers**

Open `plugin/bin/skillnote-pick`. Near the top (right after `CONFIG_PATH` at line 25), add:

```python
import re as _re

RESERVED_WORDS = ("anthropic", "claude")
_SLUG_PATTERN = _re.compile(r"^[a-z0-9_-]+$")
_MAX_NAME = 128


def _slugify(name):
    s = (name or "").lower()
    s = _re.sub(r"[^a-z0-9_-]+", "-", s)
    s = _re.sub(r"-+", "-", s)
    s = s.strip("-")
    return s[:_MAX_NAME]


def _is_valid_slug(s):
    if not s or len(s) > _MAX_NAME:
        return False
    if not _SLUG_PATTERN.match(s):
        return False
    if any(w in s for w in RESERVED_WORDS):
        return False
    return True


def _resolve_recommendation(folder_raw, existing):
    """Returns ('pick', idx) | ('create', slug) | ('none', None)."""
    slug = _slugify(folder_raw)
    if not slug:
        return ("none", None)
    for i, (name, _count, _skills) in enumerate(existing):
        if name == slug:
            return ("pick", i)
    if not _is_valid_slug(slug):
        return ("none", None)
    return ("create", slug)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd plugin && python -m pytest tests/test_skillnote_pick_helpers.py -v
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/skillnote-pick plugin/tests/test_skillnote_pick_helpers.py
git commit -m "feat(plugin): add pure helpers _slugify/_is_valid_slug/_resolve_recommendation"
```

---

## Task 10: Replace `★` with `(Recommended)` label in curses picker

**Files:**
- Modify: `plugin/bin/skillnote-pick` (around lines 382-384, 403-404)

- [ ] **Step 1: Update the list row rendering**

Open `plugin/bin/skillnote-pick`. Find the list-row rendering block (around lines 378-386):

```python
                if is_focused:
                    s(row, nx, name, ACCENT)
                else:
                    s(row, nx, name, DIM if not is_rec else 0)
                if is_rec:
                    s(row, nx + len(name) + 1, "★", YELLOW | (0 if is_focused else DIM))

                cnt = str(count)
                s(row, bx + left_w - len(cnt) - 2, cnt, DIM)
```

Replace the `★` rendering with the `(Recommended)` bracketed label:

```python
                if is_focused:
                    s(row, nx, name, ACCENT)
                else:
                    s(row, nx, name, DIM if not is_rec else 0)
                if is_rec:
                    rec_label = " (Recommended)"
                    s(row, nx + len(name), rec_label, DIM if not is_focused else ACCENT)

                cnt = str(count)
                s(row, bx + left_w - len(cnt) - 2, cnt, DIM)
```

- [ ] **Step 2: Update the right-panel preview header**

Find (around lines 401-408):

```python
                # Header
                header = sel_name
                if sel_is_rec:
                    header += " ★"
                if focus == "right":
                    s(rr, bx + left_w + 3, "❯ " + header, ACCENT)
                else:
                    s(rr, bx + left_w + 4, header, BOLD)
```

Replace with:

```python
                # Header
                header = sel_name
                if sel_is_rec:
                    header += " (Recommended)"
                if focus == "right":
                    s(rr, bx + left_w + 3, "❯ " + header, ACCENT)
                else:
                    s(rr, bx + left_w + 4, header, BOLD)
```

- [ ] **Step 3: Smoke test**

```bash
cd ~/path/to/skillnote && SKILLNOTE_HOST=localhost plugin/bin/skillnote-pick
```

Expected: the recommended collection shows `(Recommended)` next to its name, not `★`. Press esc to exit.

- [ ] **Step 4: Commit**

```bash
git add plugin/bin/skillnote-pick
git commit -m "feat(plugin): replace star marker with (Recommended) bracketed label"
```

---

## Task 11: Pinned Skip row + Ctrl+K hotkey + confirmation modal

**Files:**
- Modify: `plugin/bin/skillnote-pick` (list rendering + key handler)

- [ ] **Step 1: Reserve a pinned row below the scrollable list**

Open `plugin/bin/skillnote-pick`. Find the bottom of the list-rendering block (the `while row < h - footer_h - 1` padding loop around line 390-392):

```python
            # Pad remaining left rows
            while row < h - footer_h - 1:
                hline(row)
                row += 1
```

Replace with (reserve one extra row for Skip):

```python
            # Pad remaining left rows (reserve one row for the pinned Skip entry)
            while row < h - footer_h - 2:
                hline(row)
                row += 1

            # Pinned Skip row — always visible
            skip_is_focused = (focus == "left" and cur == len(filtered))  # one past last
            hline(row)
            skip_label = "⊘ Skip (Ctrl+K)"
            if skip_is_focused:
                s(row, bx + 3, "❯", ACCENT)
                s(row, bx + 5, skip_label, ACCENT)
            else:
                s(row, bx + 5, skip_label, DIM)
            row += 1
```

This extends the navigable list by one virtual row (`len(filtered)` → Skip).

- [ ] **Step 2: Make Down arrow reachable into the Skip row**

Find the Down-arrow handler (around line 485-492):

```python
        elif key == curses.KEY_DOWN:
            if focus == "left":
                if filtered and cur < len(filtered) - 1:
                    cur += 1
                    right_scroll = 0
            else:
                if sel_skills and right_scroll < len(sel_skills) - 1:
                    right_scroll += 1
```

Replace with:

```python
        elif key == curses.KEY_DOWN:
            if focus == "left":
                # Allow navigating onto the pinned Skip row (index == len(filtered))
                if cur < len(filtered):
                    cur += 1
                    right_scroll = 0
            else:
                if sel_skills and right_scroll < len(sel_skills) - 1:
                    right_scroll += 1
```

Add a helper function near the top of the file (after `_resolve_recommendation`, before `pick(...)`):

```python
def _confirm_skip(stdscr):
    """Draw a centered modal and return True if user confirms."""
    h, w = stdscr.getmaxyx()
    box_h, box_w = 5, 40
    y = (h - box_h) // 2
    x = (w - box_w) // 2
    stdscr.attron(curses.A_BOLD)
    for i in range(box_h):
        stdscr.addstr(y + i, x, " " * box_w, curses.A_REVERSE)
    stdscr.attroff(curses.A_BOLD)
    stdscr.addstr(y + 1, x + 2, "Are you sure you want to skip?", curses.A_REVERSE | curses.A_BOLD)
    stdscr.addstr(y + 3, x + 2, "[Y] Yes       [N] Cancel", curses.A_REVERSE)
    stdscr.refresh()
    while True:
        k = stdscr.getch()
        if k in (ord("y"), ord("Y"), 10, 13, curses.KEY_ENTER):
            return True
        if k in (ord("n"), ord("N"), 27):
            return False
```

- [ ] **Step 3: Handle Enter on Skip row + Ctrl+K hotkey**

Find the Enter-handling block (around lines 497-500):

```python
        elif key in (ord("\n"), curses.KEY_ENTER, 10, 13):
            if filtered:
                _, orig_idx, _ = filtered[cur]
                return [items[orig_idx][0]]
```

Replace with:

```python
        elif key in (ord("\n"), curses.KEY_ENTER, 10, 13):
            if focus == "left" and cur == len(filtered):
                # Skip row
                if _confirm_skip(stdscr):
                    return "__SKIP__"
                continue
            if filtered:
                _, orig_idx, _ = filtered[cur]
                return [items[orig_idx][0]]
        elif key == 11:  # Ctrl+K
            if _confirm_skip(stdscr):
                return "__SKIP__"
```

- [ ] **Step 4: Handle the Skip sentinel in `main()`**

Find `main()` near the bottom (around line 619-628) and update the "not chosen / chosen" block. Replace:

```python
    if HAS_CURSES:
        chosen = curses.wrapper(pick, collections, recommended)
    else:
        chosen = pick_fallback(collections, recommended)
    if not chosen:
        current = _get_current_collections()
        if current:
            print(f"  ✦ SkillNote: {', '.join(current)} (active)")
        return
    current = _get_current_collections()
    changed = current != chosen
    try:
        with open(CONFIG_PATH, "w") as f:
            json.dump({"collections": chosen}, f, indent=2)
            f.write("\n")
    except PermissionError:
        print("  ✦ SkillNote: cannot write .skillnote.json (permission denied)", file=sys.stderr)
        return
    if changed and current is not None:
        _clean_skills_dir()
    _run_sync()
```

With:

```python
    if HAS_CURSES:
        chosen = curses.wrapper(pick, collections, recommended)
    else:
        chosen = pick_fallback(collections, recommended)
    if chosen is None:
        current = _get_current_collections()
        if current:
            print(f"  ✦ SkillNote: {', '.join(current)} (active)")
        return
    current = _get_current_collections()
    if chosen == "__SKIP__":
        try:
            with open(CONFIG_PATH, "w") as f:
                json.dump({"collections": []}, f, indent=2)
                f.write("\n")
        except PermissionError:
            print("  ✦ SkillNote: cannot write .skillnote.json (permission denied)", file=sys.stderr)
            return
        _clean_skills_dir()
        print("  ✦ SkillNote: no collection active (skipped)")
        return
    changed = current != chosen
    try:
        with open(CONFIG_PATH, "w") as f:
            json.dump({"collections": chosen}, f, indent=2)
            f.write("\n")
    except PermissionError:
        print("  ✦ SkillNote: cannot write .skillnote.json (permission denied)", file=sys.stderr)
        return
    if changed and current is not None:
        _clean_skills_dir()
    _run_sync()
```

- [ ] **Step 5: Smoke test**

```bash
plugin/bin/skillnote-pick
```

Expected: press Down past the last collection → lands on `⊘ Skip (Ctrl+K)`. Press Enter → confirmation modal appears. Press Y → skips. Also test Ctrl+K from anywhere → modal appears. Verify `.skillnote.json` contains `{"collections": []}`.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/skillnote-pick
git commit -m "feat(plugin): add pinned Skip row + Ctrl+K hotkey + confirmation modal"
```

---

## Task 12: Search-driven Create row + create flow + 409 handling

**Files:**
- Modify: `plugin/bin/skillnote-pick` (list rendering + `fetch_collections` refresh + Enter handler)

- [ ] **Step 1: Add an API helper for creating collections**

Near the top of `plugin/bin/skillnote-pick` (after `_get_host` at line 54), add:

```python
def _create_collection(name):
    """Returns ('ok', None) | ('exists', count) | ('error', msg)."""
    import urllib.error
    host = _get_host()
    api = f"http://{host}:8082"
    payload = json.dumps({"name": name, "description": ""}).encode()
    req = urllib.request.Request(
        f"{api}/v1/collections",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=3).read()
        return ("ok", None)
    except urllib.error.HTTPError as e:
        if e.code == 409:
            # Collection already exists — fetch its count
            try:
                data = json.loads(urllib.request.urlopen(
                    f"{api}/v1/skills?collections={name}", timeout=3).read())
                return ("exists", len(data))
            except Exception:
                return ("exists", 0)
        return ("error", f"HTTP {e.code}")
    except Exception as e:
        return ("error", str(e))


def _confirm_activate_existing(stdscr, name, count):
    """Inline Y/N prompt when Create hits a 409. Returns True to activate."""
    h, w = stdscr.getmaxyx()
    box_h, box_w = 5, min(w - 4, 60)
    y = (h - box_h) // 2
    x = (w - box_w) // 2
    for i in range(box_h):
        stdscr.addstr(y + i, x, " " * box_w, curses.A_REVERSE)
    msg = f'"{name}" already exists with {count} skill(s).'
    stdscr.addstr(y + 1, x + 2, msg[:box_w - 4], curses.A_REVERSE | curses.A_BOLD)
    stdscr.addstr(y + 3, x + 2, "Activate it? [Y] Yes  [N] No", curses.A_REVERSE)
    stdscr.refresh()
    while True:
        k = stdscr.getch()
        if k in (ord("y"), ord("Y"), 10, 13, curses.KEY_ENTER):
            return True
        if k in (ord("n"), ord("N"), 27):
            return False
```

- [ ] **Step 2: Compute the create-suggestion row as the first list item**

Find the filter block (around lines 227-231):

```python
        # Filter
        if search:
            filtered = [(si, oi, it) for si, (oi, it) in enumerate(sorted_items)
                        if search.lower() in it[0].lower()]
        else:
            filtered = [(si, oi, it) for si, (oi, it) in enumerate(sorted_items)]
```

Replace with (compute create-slug and prepend/append a synthetic row):

```python
        # Filter
        if search:
            filtered = [(si, oi, it) for si, (oi, it) in enumerate(sorted_items)
                        if search.lower() in it[0].lower()]
        else:
            filtered = [(si, oi, it) for si, (oi, it) in enumerate(sorted_items)]

        # Determine the create-slug for this frame:
        #   - with a search query and no existing match → "+ Create '{slugify(query)}'" (if valid)
        #   - no query, and recommendation is "create" (folder had no match) → "+ Create '{folder_slug}'"
        create_slug = None
        if search:
            qs = _slugify(search)
            if qs and _is_valid_slug(qs) and not any(n == qs for n, _, _ in items):
                if not filtered:  # only show create when filter is empty
                    create_slug = qs
        else:
            # Use the startup recommendation if it's a "create" type
            if recommended_kind == "create":
                create_slug = recommended_slug

        # If we're showing a create row, prepend a synthetic entry to filtered
        if create_slug is not None:
            synthetic = (-1, -1, (f"+ Create '{create_slug}'", 0, []))
            filtered = [synthetic] + filtered
```

- [ ] **Step 3: Thread the recommendation result from `main()` into `pick(...)`**

Find the `pick(stdscr, items, recommended=0)` signature (around line 173) and update:

```python
def pick(stdscr, items, recommended=0, recommended_kind="pick", recommended_slug=None):
```

Find where `pick` uses `recommended` to build `sorted_items` (around line 174-181):

```python
    # Sort: recommended first
    sorted_items = []
    if 0 <= recommended < len(items):
        sorted_items.append((recommended, items[recommended]))
    for i, it in enumerate(items):
        if i != recommended:
            sorted_items.append((i, it))
```

Replace with:

```python
    # Sort: recommended first (only when recommendation kind is 'pick')
    sorted_items = []
    if recommended_kind == "pick" and 0 <= recommended < len(items):
        sorted_items.append((recommended, items[recommended]))
        for i, it in enumerate(items):
            if i != recommended:
                sorted_items.append((i, it))
    else:
        for i, it in enumerate(items):
            sorted_items.append((i, it))
```

Change the caller in `main()`. Find (around line 619):

```python
    recommended = _get_recommended(collections)
    if HAS_CURSES:
        chosen = curses.wrapper(pick, collections, recommended)
    else:
        chosen = pick_fallback(collections, recommended)
```

Replace with:

```python
    folder_raw = os.path.basename(os.getcwd())
    rec_kind, rec_payload = _resolve_recommendation(folder_raw, collections)
    if rec_kind == "pick":
        recommended_idx = rec_payload
        recommended_slug = None
    else:
        recommended_idx = -1
        recommended_slug = rec_payload if rec_kind == "create" else None
    if HAS_CURSES:
        chosen = curses.wrapper(pick, collections, recommended_idx, rec_kind, recommended_slug)
    else:
        chosen = pick_fallback(collections, recommended_idx, rec_kind, recommended_slug)
```

(Remove or keep `_get_recommended` — it's no longer used from main but leaving it doesn't hurt.)

- [ ] **Step 4: Handle Enter on a synthetic create row**

Find the Enter-handler updated in Task 11:

```python
        elif key in (ord("\n"), curses.KEY_ENTER, 10, 13):
            if focus == "left" and cur == len(filtered):
                # Skip row
                if _confirm_skip(stdscr):
                    return "__SKIP__"
                continue
            if filtered:
                _, orig_idx, _ = filtered[cur]
                return [items[orig_idx][0]]
```

Replace with:

```python
        elif key in (ord("\n"), curses.KEY_ENTER, 10, 13):
            if focus == "left" and cur == len(filtered):
                # Skip row
                if _confirm_skip(stdscr):
                    return "__SKIP__"
                continue
            if filtered:
                _, orig_idx, (sel_name, _, _) = filtered[cur]
                if orig_idx == -1:
                    # Synthetic "+ Create 'X'" row — create via API
                    new_name = sel_name.split("'")[1]  # extract slug between quotes
                    status, payload = _create_collection(new_name)
                    if status == "ok":
                        return [new_name]
                    if status == "exists":
                        if _confirm_activate_existing(stdscr, new_name, payload or 0):
                            return [new_name]
                        continue  # return to picker, keep query
                    # error case — show one-line toast then continue
                    h, w = stdscr.getmaxyx()
                    stdscr.addstr(h - 2, 2, f"Create failed: {payload}. Press any key."[:w - 4], curses.A_REVERSE)
                    stdscr.refresh()
                    stdscr.getch()
                    continue
                return [items[orig_idx][0]]
```

- [ ] **Step 5: Smoke test**

```bash
plugin/bin/skillnote-pick
```

Expected: type a new name like `my-new-collection` → `+ Create 'my-new-collection'` appears; press Enter → collection is created via API, picker exits, `.skillnote.json` holds the new name.

Type an existing name variation, e.g. `FRONTEND` if `frontend` exists — search filter still shows `frontend`; but if you type `frontend-plus` and no match exists, Create row appears.

Launch from a folder like `my-random-project` that doesn't match any collection → top row is `+ Create 'my-random-project' (Recommended)`.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/skillnote-pick
git commit -m "feat(plugin): search-driven Create row + create flow + 409 activate-existing prompt"
```

---

## Task 13: Update `pick_fallback()` for parity

**Files:**
- Modify: `plugin/bin/skillnote-pick` (`pick_fallback` function, around lines 515-537)

- [ ] **Step 1: Replace the fallback function**

Find `pick_fallback(items, recommended=0)` (around line 515). Replace the entire function with:

```python
def pick_fallback(items, recommended=0, recommended_kind="pick", recommended_slug=None):
    """Non-curses fallback — plain numbered input, parity with curses options."""
    print("\n ✦ S K I L L N O T E — Pick a collection\n")

    # Optional Create-suggestion row for unmatched folder
    offset = 0
    if recommended_kind == "create" and recommended_slug:
        print(f"  0. + Create '{recommended_slug}' (Recommended)")
        offset = 1

    if recommended_kind == "pick" and 0 <= recommended < len(items):
        order = [recommended] + [i for i in range(len(items)) if i != recommended]
    else:
        order = list(range(len(items)))

    for pos, i in enumerate(order):
        name, count, skills = items[i]
        rec = " (Recommended)" if i == recommended and recommended_kind == "pick" else ""
        print(f"  {pos + 1}. {name} ({count} skills){rec}")

    print(f"  C. Create new collection")
    print(f"  S. Skip (use no collections)")
    print()
    try:
        reply = input("  > ").strip()
    except (EOFError, KeyboardInterrupt):
        return None
    if not reply or reply.lower() == "q":
        return None

    if reply.lower() == "s":
        try:
            confirm = input("  Are you sure you want to skip? [Y/N] ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            return None
        return "__SKIP__" if confirm in ("y", "yes") else None

    if reply.lower() == "c":
        try:
            new_name = input("  New collection name: ").strip()
        except (EOFError, KeyboardInterrupt):
            return None
        if not _is_valid_slug(new_name):
            print("  Invalid name. Use only lowercase letters, numbers, hyphens, underscores.")
            return None
        status, payload = _create_collection(new_name)
        if status == "ok":
            return [new_name]
        if status == "exists":
            try:
                confirm = input(f'  "{new_name}" exists with {payload or 0} skill(s). Activate? [Y/N] ').strip().lower()
            except (EOFError, KeyboardInterrupt):
                return None
            return [new_name] if confirm in ("y", "yes") else None
        print(f"  Create failed: {payload}")
        return None

    # "0" → create-suggestion
    if offset and reply == "0":
        status, payload = _create_collection(recommended_slug)
        if status == "ok":
            return [recommended_slug]
        if status == "exists":
            return [recommended_slug]  # existing — just activate it
        print(f"  Create failed: {payload}")
        return None

    try:
        n = int(reply)
        if 1 <= n <= len(items):
            return [items[order[n - 1]][0]]
    except (ValueError, IndexError):
        pass
    return None
```

- [ ] **Step 2: Smoke test the fallback**

```bash
plugin/bin/skillnote-pick < /dev/null
```

The non-tty branch runs `pick_fallback`. Use the picker from a TTY-less environment (e.g., pipe a number). Expected: all three options (numeric, `C`, `S`) work correctly.

- [ ] **Step 3: Commit**

```bash
git add plugin/bin/skillnote-pick
git commit -m "feat(plugin): bring pick_fallback to parity with curses (Create/Skip/Recommended)"
```

---

## Task 14: Update the slash-command picker SKILL.md

**Files:**
- Modify: `plugin/skills/collection/SKILL.md`

- [ ] **Step 1: Replace the Step 2 example and add Create + Skip + Recommended**

Open `plugin/skills/collection/SKILL.md`. Replace the entire Step 2 block (lines 19-42) with:

```markdown
## Step 2: Show picker — MUST use AskUserQuestion

You MUST call the AskUserQuestion tool. Do NOT print a table or ask a text question.

Call AskUserQuestion with these EXACT parameters:
- `header`: "SkillNote"
- `question`: "Pick a collection for this project:"
- Build `options` in this order:
  1. **Recommended first:** if `basename(cwd)` (lowercase, non-alphanumeric replaced with `-`) matches an existing collection name, put that option first and append ` · Recommended` to its description. Example description: `"12 skills · Recommended"`.
  2. All other existing collections, each with `label` = name, `description` = `"{count} skills"`.
  3. **If `.skillnote.json` exists**, add "(current)" to the currently-active collection's label.
  4. `{"label": "Create new collection…", "description": "type a name next"}`
  5. `{"label": "Skip (use no collections)", "description": "no skills synced"}`

Example AskUserQuestion call:
```json
{
  "header": "SkillNote",
  "question": "Pick a collection for this project:",
  "options": [
    {"label": "frontend (current)", "description": "12 skills · Recommended"},
    {"label": "backend", "description": "8 skills"},
    {"label": "devops", "description": "3 skills"},
    {"label": "Create new collection…", "description": "type a name next"},
    {"label": "Skip (use no collections)", "description": "no skills synced"}
  ]
}
```
```

- [ ] **Step 2: Replace Step 3 (Apply selection) with branching logic**

Replace Step 3 (lines 44-55) with:

```markdown
## Step 3: Apply selection

Branch based on what the user picked:

### 3a. Existing collection or "(current)" option
Strip any ` (current)` suffix. Then run:

```bash
echo '{"collections": ["<SELECTED_NAME>"]}' > .skillnote.json
skillnote-sync --force 2>/dev/null || true
```

Tell the user: "Switched to {name}. Skills will refresh."

### 3b. "Create new collection…"
Ask the user for a name in a plain text turn:

> What should the new collection be called? (lowercase letters, numbers, hyphens, underscores — example: `my-project`)

Wait for their reply. Validate: name must match `^[a-z0-9_-]+$`, be 1–128 chars, and not contain `anthropic` or `claude`. If invalid, explain and re-prompt once.

Create the collection:

```bash
curl -sf -X POST "http://${CLAUDE_PLUGIN_OPTION_HOST:-localhost}:8082/v1/collections" \
  -H "Content-Type: application/json" \
  -d '{"name": "<NAME>", "description": ""}'
```

If curl returns a 409 conflict, the collection already exists — tell the user and offer to activate it instead (one-question AskUserQuestion: `Yes, activate / No, pick a different name`).

On success, write the name to `.skillnote.json` and run sync the same way as 3a.

### 3c. "Skip (use no collections)"
Write an empty collections list:

```bash
echo '{"collections": []}' > .skillnote.json
skillnote-sync --force 2>/dev/null || true
```

Tell the user: "Skipped. No skills will be synced to this project."
```

- [ ] **Step 3: Smoke test via `/skillnote:collection`**

Run `/skillnote:collection` in a Claude Code session and verify the three branches work as expected.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/collection/SKILL.md
git commit -m "feat(plugin): add Create/Skip/Recommended options to /skillnote:collection"
```

---

## Task 15: Add collection-name guidance to skill-push SKILL.md

**Files:**
- Modify: `plugin/skills/skill-push/SKILL.md` (Step 4, around line 66-70)

- [ ] **Step 1: Update Step 4 guidance**

Open `plugin/skills/skill-push/SKILL.md`. Find the Step 4 block (around line 66-70):

```markdown
Every skill must belong to at least one collection. Use **AskUserQuestion** to let the user pick:
- Show existing collections from the list above as options
- Include an option to type a new collection name
- Recommend the collection that best fits the skill's domain
- A skill cannot be pushed without a collection
```

Replace with:

```markdown
Every skill must belong to at least one collection. Use **AskUserQuestion** to let the user pick:
- Show existing collections from the list above as options
- Include an option to type a new collection name — names must match `^[a-z0-9_-]+$` (lowercase letters, numbers, hyphens, underscores), 1–128 chars, and cannot contain reserved words `anthropic` or `claude`
- Recommend the collection that best fits the skill's domain
- A skill cannot be pushed without a collection

If the user types an invalid name, the POST /v1/skills call will return 422 `COLLECTION_NAME_INVALID`. Surface the error, explain the rule, and ask them to type a valid name before retrying.
```

- [ ] **Step 2: Commit**

```bash
git add plugin/skills/skill-push/SKILL.md
git commit -m "docs(plugin): document collection-name rule in skill-push guidance"
```

---

## Final Verification

- [ ] **Step 1: Run the full backend test suite**

```bash
cd backend && pytest
```

Expected: all tests pass.

- [ ] **Step 2: Run Playwright e2e**

```bash
npx playwright test
```

Expected: all tests pass.

- [ ] **Step 3: Run plugin helper tests**

```bash
cd plugin && python -m pytest tests/
```

Expected: all tests pass.

- [ ] **Step 4: Push the branch and open a PR**

```bash
git push -u origin feat/collection-picker-options
gh pr create --title "feat: collection picker options (Create / Skip / Recommended)" --body "$(cat <<'EOF'
## Summary
- Adds Create new / Skip / (Recommended) options to the terminal collection picker (`plugin/bin/skillnote-pick`) and the `/skillnote:collection` slash command
- Locks down collection-name validation to `^[a-z0-9_-]+$` everywhere
- Adds migration 0012 to slugify existing collection names (with skill-reference updates)

## Test plan
- [ ] Backend pytest passes
- [ ] Playwright e2e passes
- [ ] Plugin helper tests pass
- [ ] Manual picker walkthrough: Recommended for known folder, Create for new folder, Skip clears
- [ ] Confirm migration runs cleanly on a seed DB and is idempotent

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

**Spec coverage check:** Tasks 1-2 cover validator infrastructure; Task 3 covers the slugify migration; Tasks 4-5 cover handler-level skill API validation; Tasks 6-8 cover web UI; Tasks 9-13 cover the curses picker; Task 14 covers the slash command; Task 15 covers skill-push guidance. Every "Touch Points" bullet in the spec maps to a task.

**Placeholders:** none. All code blocks contain literal implementations.

**Type consistency:** `_slugify`, `_is_valid_slug`, `_resolve_recommendation` have the same signatures in Task 9 (helpers) and Task 12 (callers).
