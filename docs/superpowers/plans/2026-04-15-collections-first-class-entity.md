# Collections as First-Class DB Entity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote collections from localStorage-only strings to a first-class DB entity so empty collections created via the web UI appear in the CLI picker (`skillnote-pick`).

**Architecture:** Add a `collections` table keyed by `name`. Extend `GET /v1/collections` to UNION (skills-derived names) with (empty rows from the table). Add CRUD endpoints. Port `NewCollectionModal` to POST to the API with graceful localStorage fallback for offline. On `/collections` page load, auto-migrate stale localStorage-meta entries to the API. The CLI picker needs zero changes — it already fetches `/v1/collections`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Pydantic 2, Next.js 16, React 19, TypeScript.

**Release:** 0.3.1 (branch: `master-0.3.1`)

---

## File Structure

**Backend (created):**
- `backend/alembic/versions/0011_collections_table.py` — migration
- `backend/app/db/models/collection.py` — SQLAlchemy model
- `backend/app/schemas/collection.py` — Pydantic request/response schemas
- `backend/app/validators/collection_validator.py` — name validation rules
- `backend/tests/unit/test_collection_validator.py`
- `backend/tests/integration/test_collections_api.py`

**Backend (modified):**
- `backend/app/db/models/__init__.py` — register `Collection`
- `backend/app/api/collections.py` — add CRUD endpoints + UNION in GET

**Frontend (created):**
- `src/lib/api/collections.ts` — typed API client

**Frontend (modified):**
- `src/components/collections/NewCollectionModal.tsx` — POST to API
- `src/app/(app)/collections/page.tsx` — fetch from API + auto-migrate
- `src/lib/derived.ts` — accept API-provided collections
- `src/components/collections/CollectionPicker.tsx` — fetch from API

**Release artifacts:**
- `package.json` — version bump 0.3.0 → 0.3.1
- `CHANGELOG.md` — 0.3.1 entry

---

## Design Decisions (Locked)

- **Primary key**: `name TEXT` — simpler than UUID, matches current reference semantics where skills store collection names.
- **Rename**: NOT supported in 0.3.1. PUT only updates `description`. Renames can come later with a cascade backfill.
- **Delete guard**: 409 if any skill still references the collection.
- **GET response shape**: `[{name, count, description}]` — additive, CLI picker keeps working (ignores unknown field).
- **Validation**: Collection names are free-form text (unlike skill names) to preserve existing values like `"lp assessment"`. Rules: non-empty after trim, max 128 chars, no XML tags, no newlines.
- **Migration**: On `/collections` page load, diff localStorage `skillnote:collections-meta` against API; POST any missing entries; clear localStorage key on full success. One-shot, idempotent.

---

## Task 1: Alembic migration for `collections` table

**Files:**
- Create: `backend/alembic/versions/0011_collections_table.py`

- [ ] **Step 1: Write the migration**

```python
"""create collections table

Revision ID: 0011_collections_table
Revises: 0010_pick_sessions
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = '0011_collections_table'
down_revision = '0010_pick_sessions'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'collections',
        sa.Column('name', sa.Text(), primary_key=True),
        sa.Column('description', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('collections')
```

- [ ] **Step 2: Apply the migration**

Run: `cd backend && alembic upgrade head`
Expected: `INFO [alembic.runtime.migration] Running upgrade 0010_pick_sessions -> 0011_collections_table`

- [ ] **Step 3: Verify the table exists**

Run: `cd backend && python -c "from app.db.session import get_db; from sqlalchemy import text; db = next(get_db()); print(db.execute(text('SELECT to_regclass(\'collections\')')).scalar())"`
Expected: `collections`

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/0011_collections_table.py
git commit -m "feat(backend): add collections table migration (0011)"
```

---

## Task 2: Collection SQLAlchemy model

**Files:**
- Create: `backend/app/db/models/collection.py`
- Modify: `backend/app/db/models/__init__.py`

- [ ] **Step 1: Write the model**

Path: `backend/app/db/models/collection.py`

```python
from datetime import datetime

from sqlalchemy import DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Collection(Base):
    __tablename__ = "collections"

    name: Mapped[str] = mapped_column(Text, primary_key=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
```

- [ ] **Step 2: Register in `__init__.py`**

Modify `backend/app/db/models/__init__.py` from:

```python
from app.db.models.analytics_event import AnalyticsEvent
from app.db.models.comment import Comment
from app.db.models.skill import Skill
from app.db.models.skill_content_version import SkillContentVersion
from app.db.models.skill_rating import SkillRating
from app.db.models.skill_version import SkillVersion

__all__ = ["Skill", "SkillVersion", "SkillContentVersion", "Comment", "AnalyticsEvent", "SkillRating"]
```

to:

```python
from app.db.models.analytics_event import AnalyticsEvent
from app.db.models.collection import Collection
from app.db.models.comment import Comment
from app.db.models.skill import Skill
from app.db.models.skill_content_version import SkillContentVersion
from app.db.models.skill_rating import SkillRating
from app.db.models.skill_version import SkillVersion

__all__ = ["Skill", "SkillVersion", "SkillContentVersion", "Comment", "AnalyticsEvent", "SkillRating", "Collection"]
```

- [ ] **Step 3: Verify import works**

Run: `cd backend && python -c "from app.db.models import Collection; print(Collection.__tablename__)"`
Expected: `collections`

- [ ] **Step 4: Commit**

```bash
git add backend/app/db/models/collection.py backend/app/db/models/__init__.py
git commit -m "feat(backend): add Collection SQLAlchemy model"
```

---

## Task 3: Collection validator with tests

**Files:**
- Create: `backend/app/validators/collection_validator.py`
- Create: `backend/tests/unit/test_collection_validator.py`

- [ ] **Step 1: Write the failing tests**

Path: `backend/tests/unit/test_collection_validator.py`

```python
"""Unit tests for collection name validation."""
from app.validators.collection_validator import validate_collection_name


class TestValidateCollectionName:
    def test_valid_name_with_spaces(self):
        assert validate_collection_name("lp assessment") == []

    def test_valid_single_word(self):
        assert validate_collection_name("frontend") == []

    def test_empty_rejected(self):
        errors = validate_collection_name("")
        assert any("required" in e.lower() for e in errors)

    def test_whitespace_only_rejected(self):
        errors = validate_collection_name("   ")
        assert any("required" in e.lower() for e in errors)

    def test_too_long_rejected(self):
        errors = validate_collection_name("x" * 129)
        assert any("128" in e for e in errors)

    def test_newline_rejected(self):
        errors = validate_collection_name("foo\nbar")
        assert any("newline" in e.lower() or "invalid" in e.lower() for e in errors)

    def test_xml_tag_rejected(self):
        errors = validate_collection_name("<script>")
        assert any("xml" in e.lower() or "tag" in e.lower() for e in errors)

    def test_boundary_128_chars_accepted(self):
        assert validate_collection_name("x" * 128) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/unit/test_collection_validator.py -v`
Expected: `ModuleNotFoundError: No module named 'app.validators.collection_validator'`

- [ ] **Step 3: Implement validator**

Path: `backend/app/validators/collection_validator.py`

```python
import re

COLLECTION_NAME_MAX = 128
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
    if XML_TAG_RE.search(stripped):
        errors.append("Collection name cannot contain XML tags")
    return errors
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/unit/test_collection_validator.py -v`
Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/validators/collection_validator.py backend/tests/unit/test_collection_validator.py
git commit -m "feat(backend): add collection name validator with tests"
```

---

## Task 4: Pydantic schemas for collection API

**Files:**
- Create: `backend/app/schemas/collection.py`

- [ ] **Step 1: Write the schemas**

Path: `backend/app/schemas/collection.py`

```python
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

from app.validators.collection_validator import validate_collection_name


class CollectionListItem(BaseModel):
    name: str
    count: int
    description: str = ""


class CollectionCreate(BaseModel):
    name: str
    description: str = ""

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str) -> str:
        errors = validate_collection_name(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v.strip()

    @field_validator("description")
    @classmethod
    def check_description(cls, v: Optional[str]) -> str:
        if v is None:
            return ""
        if len(v) > 1024:
            raise ValueError("Description must be 1024 characters or fewer")
        return v.strip()


class CollectionUpdate(BaseModel):
    description: str

    @field_validator("description")
    @classmethod
    def check_description(cls, v: str) -> str:
        if v is None:
            return ""
        if len(v) > 1024:
            raise ValueError("Description must be 1024 characters or fewer")
        return v.strip()


class CollectionDetail(BaseModel):
    model_config = {"from_attributes": True}

    name: str
    description: str
    created_at: datetime
    updated_at: datetime
```

- [ ] **Step 2: Verify schemas import cleanly**

Run: `cd backend && python -c "from app.schemas.collection import CollectionCreate; CollectionCreate(name='foo', description='bar')"`
Expected: no output (success)

- [ ] **Step 3: Verify validation triggers on empty name**

Run: `cd backend && python -c "from app.schemas.collection import CollectionCreate; CollectionCreate(name='', description='bar')"`
Expected: `pydantic_core._pydantic_core.ValidationError` mentioning "Collection name is required"

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/collection.py
git commit -m "feat(backend): add Pydantic schemas for collection API"
```

---

## Task 5: Extend `GET /v1/collections` to UNION table with skill-derived names

**Files:**
- Modify: `backend/app/api/collections.py`
- Create: `backend/tests/integration/test_collections_api.py`

- [ ] **Step 1: Write the failing integration tests**

Path: `backend/tests/integration/test_collections_api.py`

```python
"""Integration tests for /v1/collections CRUD.

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
def unique_name():
    return f"test-col-{uuid.uuid4().hex[:8]}"


def test_create_empty_collection_appears_in_list(unique_name):
    status, _ = _request("POST", "/v1/collections", {"name": unique_name, "description": "desc"})
    assert status == 201

    status, cols = _request("GET", "/v1/collections")
    assert status == 200
    names = [c["name"] for c in cols]
    assert unique_name in names

    match = next(c for c in cols if c["name"] == unique_name)
    assert match["count"] == 0
    assert match["description"] == "desc"

    _request("DELETE", f"/v1/collections/{unique_name}")


def test_list_shape_includes_description_field():
    status, cols = _request("GET", "/v1/collections")
    assert status == 200
    if cols:
        assert "description" in cols[0]
        assert "name" in cols[0]
        assert "count" in cols[0]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/integration/test_collections_api.py -v`
Expected: failures or 404s on POST (endpoint doesn't exist yet). If API unreachable, tests skip — start it first: `docker compose up -d api`.

- [ ] **Step 3: Rewrite the `list_collections` endpoint to UNION**

Modify `backend/app/api/collections.py` entirely to:

```python
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db

router = APIRouter(prefix="/v1/collections", tags=["collections"])


@router.get("")
def list_collections(db: Session = Depends(get_db)):
    """Return collection names + skill counts + description.

    UNIONs collections-with-skills (derived from skills.collections arrays)
    with explicitly-created empty collections from the collections table.
    """
    rows = db.execute(
        text(
            """
            SELECT name, count, COALESCE(c.description, '') AS description
            FROM (
                SELECT name, COUNT(*) AS count FROM (
                    SELECT unnest(collections) AS name FROM skills
                    WHERE collections IS NOT NULL AND collections != '{}'
                ) sub GROUP BY name
                UNION
                SELECT name, 0 AS count FROM collections
                WHERE name NOT IN (
                    SELECT DISTINCT unnest(collections) FROM skills
                    WHERE collections IS NOT NULL AND collections != '{}'
                )
            ) u
            LEFT JOIN collections c USING (name)
            ORDER BY name
            """
        )
    ).mappings().all()
    return [
        {"name": row["name"], "count": row["count"], "description": row["description"]}
        for row in rows
    ]
```

- [ ] **Step 4: Run tests, expect only `test_list_shape_includes_description_field` to pass**

Run: `cd backend && pytest tests/integration/test_collections_api.py::test_list_shape_includes_description_field -v`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/collections.py backend/tests/integration/test_collections_api.py
git commit -m "feat(backend): union empty collections into GET /v1/collections"
```

---

## Task 6: `POST /v1/collections`

**Files:**
- Modify: `backend/app/api/collections.py`
- Modify: `backend/tests/integration/test_collections_api.py`

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/integration/test_collections_api.py`:

```python
def test_post_creates_collection(unique_name):
    status, body = _request("POST", "/v1/collections", {"name": unique_name, "description": ""})
    assert status == 201
    assert body["name"] == unique_name

    _request("DELETE", f"/v1/collections/{unique_name}")


def test_post_duplicate_returns_409(unique_name):
    _request("POST", "/v1/collections", {"name": unique_name, "description": ""})
    status, body = _request("POST", "/v1/collections", {"name": unique_name, "description": ""})
    assert status == 409
    assert body["detail"]["code"] == "COLLECTION_EXISTS"

    _request("DELETE", f"/v1/collections/{unique_name}")


def test_post_rejects_empty_name():
    status, _ = _request("POST", "/v1/collections", {"name": "", "description": ""})
    assert status == 422


def test_post_trims_whitespace(unique_name):
    padded = f"  {unique_name}  "
    status, body = _request("POST", "/v1/collections", {"name": padded, "description": ""})
    assert status == 201
    assert body["name"] == unique_name

    _request("DELETE", f"/v1/collections/{unique_name}")
```

- [ ] **Step 2: Run the new tests — expect 404 (endpoint doesn't exist)**

Run: `cd backend && pytest tests/integration/test_collections_api.py::test_post_creates_collection -v`
Expected: 405 or 404 on the POST.

- [ ] **Step 3: Add POST endpoint**

Append to `backend/app/api/collections.py`:

```python
from datetime import datetime, timezone

from fastapi import status as http_status
from sqlalchemy.exc import IntegrityError

from app.core.errors import api_error
from app.db.models import Collection
from app.schemas.collection import CollectionCreate, CollectionDetail, CollectionUpdate


@router.post("", response_model=CollectionDetail, status_code=http_status.HTTP_201_CREATED)
def create_collection(payload: CollectionCreate, db: Session = Depends(get_db)):
    existing = db.query(Collection).filter(Collection.name == payload.name).first()
    if existing:
        raise api_error(409, "COLLECTION_EXISTS", f'Collection "{payload.name}" already exists')

    now = datetime.now(timezone.utc)
    col = Collection(
        name=payload.name,
        description=payload.description,
        created_at=now,
        updated_at=now,
    )
    db.add(col)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise api_error(409, "COLLECTION_EXISTS", f'Collection "{payload.name}" already exists')
    db.refresh(col)
    return col
```

Also add the imports at the top of the file:

```python
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, status as http_status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.models import Collection
from app.db.session import get_db
from app.schemas.collection import CollectionCreate, CollectionDetail, CollectionUpdate
```

(Consolidate duplicate imports; the final top-of-file imports should be only the set above.)

- [ ] **Step 4: Run the new tests — expect pass**

Run: `cd backend && pytest tests/integration/test_collections_api.py -k "post_" -v`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/collections.py backend/tests/integration/test_collections_api.py
git commit -m "feat(backend): add POST /v1/collections endpoint"
```

---

## Task 7: `PUT /v1/collections/{name}` (update description only)

**Files:**
- Modify: `backend/app/api/collections.py`
- Modify: `backend/tests/integration/test_collections_api.py`

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/integration/test_collections_api.py`:

```python
def test_put_updates_description(unique_name):
    _request("POST", "/v1/collections", {"name": unique_name, "description": "original"})

    status, body = _request("PUT", f"/v1/collections/{unique_name}", {"description": "updated"})
    assert status == 200
    assert body["description"] == "updated"

    status, cols = _request("GET", "/v1/collections")
    match = next(c for c in cols if c["name"] == unique_name)
    assert match["description"] == "updated"

    _request("DELETE", f"/v1/collections/{unique_name}")


def test_put_returns_404_when_not_exists():
    status, body = _request("PUT", "/v1/collections/does-not-exist-xyz", {"description": "x"})
    assert status == 404
    assert body["detail"]["code"] == "COLLECTION_NOT_FOUND"
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/integration/test_collections_api.py -k "put_" -v`
Expected: 405 or failures.

- [ ] **Step 3: Add PUT endpoint**

Append to `backend/app/api/collections.py`:

```python
@router.put("/{name}", response_model=CollectionDetail)
def update_collection(name: str, payload: CollectionUpdate, db: Session = Depends(get_db)):
    col = db.query(Collection).filter(Collection.name == name).first()
    if not col:
        raise api_error(404, "COLLECTION_NOT_FOUND", f'Collection "{name}" not found')

    col.description = payload.description
    col.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(col)
    return col
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd backend && pytest tests/integration/test_collections_api.py -k "put_" -v`
Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/collections.py backend/tests/integration/test_collections_api.py
git commit -m "feat(backend): add PUT /v1/collections/{name} endpoint"
```

---

## Task 8: `DELETE /v1/collections/{name}` with skill-reference guard

**Files:**
- Modify: `backend/app/api/collections.py`
- Modify: `backend/tests/integration/test_collections_api.py`

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/integration/test_collections_api.py`:

```python
def test_delete_empty_collection(unique_name):
    _request("POST", "/v1/collections", {"name": unique_name, "description": ""})

    status, _ = _request("DELETE", f"/v1/collections/{unique_name}")
    assert status == 204

    status, cols = _request("GET", "/v1/collections")
    names = [c["name"] for c in cols]
    assert unique_name not in names


def test_delete_404_when_not_exists():
    status, body = _request("DELETE", "/v1/collections/does-not-exist-xyz")
    assert status == 404


def test_delete_409_when_skills_reference(unique_name):
    """Creating a skill in a collection implicitly creates it — explicit POST not required."""
    skill_slug = f"test-skill-{uuid.uuid4().hex[:8]}"
    _request("POST", "/v1/skills", {
        "name": skill_slug,
        "slug": skill_slug,
        "description": "test fixture",
        "content_md": "",
        "collections": [unique_name],
    })

    status, body = _request("DELETE", f"/v1/collections/{unique_name}")
    assert status == 409
    assert body["detail"]["code"] == "COLLECTION_IN_USE"

    _request("DELETE", f"/v1/skills/{skill_slug}")
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd backend && pytest tests/integration/test_collections_api.py -k "delete_" -v`
Expected: failures or 405s.

- [ ] **Step 3: Add DELETE endpoint**

Append to `backend/app/api/collections.py`:

```python
@router.delete("/{name}", status_code=http_status.HTTP_204_NO_CONTENT)
def delete_collection(name: str, db: Session = Depends(get_db)):
    skill_ref_count = db.execute(
        text(
            "SELECT COUNT(*) FROM skills WHERE :name = ANY(collections)"
        ),
        {"name": name},
    ).scalar()

    if skill_ref_count and skill_ref_count > 0:
        raise api_error(
            409,
            "COLLECTION_IN_USE",
            f'Cannot delete "{name}": {skill_ref_count} skill(s) still reference it',
        )

    col = db.query(Collection).filter(Collection.name == name).first()
    if not col:
        raise api_error(404, "COLLECTION_NOT_FOUND", f'Collection "{name}" not found')

    db.delete(col)
    db.commit()
    return None
```

- [ ] **Step 4: Run all collection tests — expect pass**

Run: `cd backend && pytest tests/integration/test_collections_api.py -v`
Expected: `10 passed` (all tests from tasks 5-8).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/collections.py backend/tests/integration/test_collections_api.py
git commit -m "feat(backend): add DELETE /v1/collections/{name} with skill-ref guard"
```

---

## Task 9: Frontend API client for collections

**Files:**
- Create: `src/lib/api/collections.ts`

- [ ] **Step 1: Write the client**

Path: `src/lib/api/collections.ts`

```typescript
import { apiRequest } from './client'

export type CollectionListItem = {
  name: string
  count: number
  description: string
}

export type CollectionDetail = {
  name: string
  description: string
  created_at: string
  updated_at: string
}

export async function fetchCollectionsApi(): Promise<CollectionListItem[]> {
  return apiRequest<CollectionListItem[]>('/v1/collections')
}

export async function createCollectionApi(
  name: string,
  description: string,
): Promise<CollectionDetail> {
  return apiRequest<CollectionDetail>('/v1/collections', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  })
}

export async function updateCollectionApi(
  name: string,
  description: string,
): Promise<CollectionDetail> {
  return apiRequest<CollectionDetail>(`/v1/collections/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({ description }),
  })
}

export async function deleteCollectionApi(name: string): Promise<void> {
  await apiRequest<void>(`/v1/collections/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/collections.ts
git commit -m "feat(frontend): add collections API client"
```

---

## Task 10: Update `NewCollectionModal` to POST to API

**Files:**
- Modify: `src/components/collections/NewCollectionModal.tsx`

- [ ] **Step 1: Replace `handleCreate` body**

In `src/components/collections/NewCollectionModal.tsx`, replace the existing `handleCreate` function (lines 23-37) with:

```typescript
async function handleCreate() {
    if (!name.trim()) { setNameError('Name is required'); nameRef.current?.focus(); return }
    setNameError('')
    setSaving(true)
    try {
      const trimmedName = name.trim()
      const trimmedDesc = description.trim()
      try {
        await createCollectionApi(trimmedName, trimmedDesc)
      } catch (err) {
        // Fallback: keep local-only entry so user doesn't lose their work if offline
        try {
          const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
          meta[trimmedName] = { description: trimmedDesc, created_at: new Date().toISOString() }
          localStorage.setItem('skillnote:collections-meta', JSON.stringify(meta))
        } catch {}
        toast.error(err instanceof Error ? err.message : 'Could not create collection on server — saved locally')
        onCreated(trimmedName, trimmedDesc)
        onClose()
        return
      }
      onCreated(trimmedName, trimmedDesc)
      toast.success(`Collection "${trimmedName}" created`)
      onClose()
    } finally {
      setSaving(false)
    }
  }
```

Also add the import at the top of the file (right after the other imports):

```typescript
import { createCollectionApi } from '@/lib/api/collections'
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke test**

1. Start stack: `docker compose up -d postgres api && npm run dev`
2. Open http://localhost:3000/collections
3. Click "New Collection", name it `test-api-flow`, click Create
4. In another terminal: `curl -s http://localhost:8082/v1/collections | grep test-api-flow`

Expected: the collection appears in the API response with `"count":0`.

- [ ] **Step 4: Commit**

```bash
git add src/components/collections/NewCollectionModal.tsx
git commit -m "feat(frontend): persist new collections to API with offline fallback"
```

---

## Task 11: Update `/collections` page to read from API + auto-migrate localStorage

**Files:**
- Modify: `src/app/(app)/collections/page.tsx`
- Modify: `src/lib/derived.ts`

- [ ] **Step 1: Add a new helper `deriveCollectionsFromApi` to `derived.ts`**

Modify `src/lib/derived.ts` — ADD this new export after the existing `deriveCollections` function:

```typescript
import type { CollectionListItem } from './api/collections'

export function deriveCollectionsFromApi(
  skills: Skill[],
  apiCollections: CollectionListItem[],
) {
  // Build map of "most recent updatedAt" per collection from skills
  const updatedAtBySkill = new Map<string, string>()
  for (const s of skills) {
    for (const c of s.collections || []) {
      const cur = updatedAtBySkill.get(c)
      if (!cur || s.updated_at > cur) updatedAtBySkill.set(c, s.updated_at)
    }
  }

  return apiCollections.map((c, i) => ({
    id: String(i + 1),
    name: c.name,
    description: c.description || `${c.name} skills`,
    skill_count: c.count,
    updated_at: updatedAtBySkill.get(c.name) || new Date(0).toISOString(),
  }))
}
```

- [ ] **Step 2: Update `/collections` page to fetch + migrate**

Replace the body of `CollectionsPage()` in `src/app/(app)/collections/page.tsx`. Find the `useEffect` on line 22 and the `collections` memo on line 26, then rewrite both sections:

```typescript
  const [skills, setSkills] = useState(getSkills())
  const [apiCollections, setApiCollections] = useState<CollectionListItem[]>([])
  const [newCollectionOpen, setNewCollectionOpen] = useState(false)

  // One-shot migration: push stale localStorage-meta entries to the API.
  async function migrateLocalStorageCollections(apiNames: Set<string>) {
    let meta: Record<string, { description: string; created_at: string }>
    try {
      meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
    } catch {
      return
    }
    const toMigrate = Object.entries(meta).filter(([name]) => !apiNames.has(name))
    if (toMigrate.length === 0) return

    const succeeded: string[] = []
    for (const [name, data] of toMigrate) {
      try {
        await createCollectionApi(name, data.description || '')
        succeeded.push(name)
      } catch {
        // Leave in localStorage; try again next page load
      }
    }
    if (succeeded.length === 0) return

    // Remove migrated entries from localStorage
    const remaining = { ...meta }
    for (const name of succeeded) delete remaining[name]
    localStorage.setItem('skillnote:collections-meta', JSON.stringify(remaining))

    // Re-fetch so UI reflects migrated collections
    try {
      const fresh = await fetchCollectionsApi()
      setApiCollections(fresh)
    } catch {}
  }

  useEffect(() => {
    syncSkillsFromApi().then(setSkills).catch(() => {})
    fetchCollectionsApi()
      .then(async (cols) => {
        setApiCollections(cols)
        await migrateLocalStorageCollections(new Set(cols.map(c => c.name)))
      })
      .catch(() => {})
  }, [])

  const collections = useMemo(
    () => deriveCollectionsFromApi(skills, apiCollections),
    [skills, apiCollections],
  )
```

Also update the imports at the top of the file:

```typescript
import { useEffect, useMemo, useState } from 'react'
import { getSkills, syncSkillsFromApi } from '@/lib/skills-store'
import { deriveCollectionsFromApi } from '@/lib/derived'
import { createCollectionApi, fetchCollectionsApi, type CollectionListItem } from '@/lib/api/collections'
```

And update the `handleCollectionCreated` handler to re-fetch:

```typescript
async function handleCollectionCreated() {
    setSkills(s => [...s])
    try {
      const fresh = await fetchCollectionsApi()
      setApiCollections(fresh)
    } catch {}
    setNewCollectionOpen(false)
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

1. `docker compose up -d postgres api && npm run dev`
2. Seed localStorage: open dev tools console at http://localhost:3000, run:
   ```js
   localStorage.setItem('skillnote:collections-meta', JSON.stringify({"legacy-col": {"description": "from localStorage", "created_at": "2026-04-15T00:00:00Z"}}))
   ```
3. Reload `/collections`.
4. Check console: `JSON.parse(localStorage.getItem('skillnote:collections-meta'))` should return `{}`.
5. Check API: `curl http://localhost:8082/v1/collections | grep legacy-col` should find it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/derived.ts src/app/\(app\)/collections/page.tsx
git commit -m "feat(frontend): fetch collections from API and auto-migrate localStorage"
```

---

## Task 12: Update inline `CollectionPicker` (skill editor) to use API

**Files:**
- Modify: `src/components/collections/CollectionPicker.tsx`

- [ ] **Step 1: Replace `getAllCollections` function**

In `src/components/collections/CollectionPicker.tsx`, replace the `getAllCollections` function (lines 14-24) with an async fetch + local merge:

```typescript
async function getAllCollectionsAsync(): Promise<string[]> {
  const set = new Set<string>()
  try {
    for (const s of getSkills()) {
      for (const c of s.collections || []) set.add(c)
    }
  } catch {}
  try {
    const apiCols = await fetchCollectionsApi()
    for (const c of apiCols) set.add(c.name)
  } catch {
    // Offline fallback: read localStorage meta
    try {
      const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
      for (const name of Object.keys(meta)) set.add(name)
    } catch {}
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}
```

- [ ] **Step 2: Update the `useEffect` that loads collections**

Replace line 44 (`useEffect(() => { setAllCollections(getAllCollections()) }, [])`) with:

```typescript
useEffect(() => {
    getAllCollectionsAsync().then(setAllCollections)
  }, [])
```

- [ ] **Step 3: Update `add(name)` to POST new collections to API**

Replace the `add` function (lines 86-95) with:

```typescript
async function add(item: string) {
    const name = item === '__create__' ? query.trim() : item
    if (!name) return
    if (!selected.some(c => c.toLowerCase() === name.toLowerCase())) {
      onChange([...selected, name])
      if (item === '__create__') {
        try {
          await createCollectionApi(name, '')
        } catch {
          // Offline fallback: store locally
          persistCollection(name)
        }
        const fresh = await getAllCollectionsAsync()
        setAllCollections(fresh)
      }
    }
    setOpen(false)
  }
```

- [ ] **Step 4: Update imports at the top of the file**

```typescript
import { getSkills } from '@/lib/skills-store'
import { createCollectionApi, fetchCollectionsApi } from '@/lib/api/collections'
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/collections/CollectionPicker.tsx
git commit -m "feat(frontend): pull collections from API in skill-editor picker"
```

---

## Task 13: End-to-end verification against the CLI picker

**Files:** none modified — verification only.

- [ ] **Step 1: Full stack rebuild**

Run: `docker compose up --build -d`
Expected: all 3 services healthy.

- [ ] **Step 2: Create an empty collection via web UI**

1. Open http://localhost:3000/collections
2. Click "New Collection", name it `zzz-empty-picker-test`, description "verify CLI sees this", Create.

- [ ] **Step 3: Verify API returns it with count=0**

Run: `curl -s http://localhost:8082/v1/collections | python3 -m json.tool | grep -A2 zzz-empty`
Expected: `"name": "zzz-empty-picker-test"`, `"count": 0`.

- [ ] **Step 4: Run the CLI picker in another project**

1. `cd /tmp && mkdir pick-test && cd pick-test`
2. Run `python3 ~/path/to/skillnote/plugin/bin/skillnote-pick`
3. The TUI should list `zzz-empty-picker-test` with `0` next to it.

Expected: the collection is visible. Quit with `q`.

- [ ] **Step 5: Delete the test collection**

Run: `curl -X DELETE http://localhost:8082/v1/collections/zzz-empty-picker-test`
Expected: HTTP 204.

- [ ] **Step 6: Commit the verification log (optional)**

No commit — this is a manual check.

---

## Task 14: Version bump and changelog

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version in `package.json`**

In `~/path/to/skillnote/package.json` line 3, change:

```json
  "version": "0.3.0",
```

to:

```json
  "version": "0.3.1",
```

- [ ] **Step 2: Add changelog entry**

Prepend to `~/path/to/skillnote/CHANGELOG.md` (above the existing top entry):

```markdown
## 0.3.1 — 2026-04-15

### Fixed
- Empty collections created in the web UI now appear in the CLI collection picker (`skillnote-pick`). Previously they were only written to browser localStorage and invisible to the backend.

### Added
- `collections` table with full CRUD: `POST/PUT/DELETE /v1/collections`. `DELETE` is refused with 409 when any skill still references the collection.
- Auto-migration: existing `skillnote:collections-meta` localStorage entries are POSTed to the API on first load of `/collections`, then cleared from localStorage on success.

### Changed
- `GET /v1/collections` response now includes `description` field (additive, backwards-compatible).
```

- [ ] **Step 3: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): bump version to 0.3.1"
```

---

## Task 15: Open PR

- [ ] **Step 1: Push branch**

Run: `git push -u origin master-0.3.1`

- [ ] **Step 2: Open PR**

Run:

```bash
gh pr create --title "Release 0.3.1 — collections as first-class DB entity" --body "$(cat <<'EOF'
## Summary
- Promotes collections from localStorage-only strings to a first-class DB entity with CRUD API
- Empty collections now appear in the CLI picker (`skillnote-pick`) at session start
- Auto-migrates existing localStorage-meta entries to the API

## Test plan
- [ ] `cd backend && pytest tests/unit/test_collection_validator.py` — passes
- [ ] `cd backend && pytest tests/integration/test_collections_api.py` — all 10 pass
- [ ] Web UI: create empty collection → appears in `/collections` page
- [ ] CLI: run `skillnote-pick` in a fresh project → empty collection visible with count 0
- [ ] DELETE a collection with skills → returns 409 with `COLLECTION_IN_USE`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-Review Notes

**Spec coverage check:**
- Root cause fix (empty collection invisible to CLI) → Tasks 1-8 (backend) + Task 13 (verification) ✅
- `NewCollectionModal` persistence → Task 10 ✅
- Inline `CollectionPicker` uses API → Task 12 ✅
- localStorage auto-migration → Task 11 ✅
- CHANGELOG + version bump → Task 14 ✅

**Type consistency:**
- `CollectionListItem` used identically in API client (Task 9) and consumer (Task 11) ✅
- `createCollectionApi(name, description)` signature matches in Tasks 9, 10, 11, 12 ✅
- `fetchCollectionsApi(): Promise<CollectionListItem[]>` consistent across Tasks 9, 11, 12 ✅

**No placeholders:** every code block is complete and runnable. ✅

**Potential gotcha:** the UNION query in Task 5 relies on `collections` being a TEXT ARRAY; this matches the current `skills.collections` column shape (confirmed in `0002_skill_rich_fields.py`).
