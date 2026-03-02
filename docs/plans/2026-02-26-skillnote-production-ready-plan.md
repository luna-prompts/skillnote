# SkillNote Production-Ready Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 32 bugs and implement all missing features found in the E2E audit to make SkillNote production-ready.

**Architecture:** 5 ordered layers — data layer fixes, backend API extensions, core CRUD UI, polished UX, and infrastructure cleanup. Backend uses FastAPI + SQLAlchemy. Frontend uses Next.js 16 App Router (all client components). Skills data flows: backend → localStorage cache → React state.

**Tech Stack:** Next.js 16, React 19, Tiptap, Tailwind CSS v4, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL, Pydantic v2.

**Note on RSC aborts:** The 65 `ERR_ABORTED` RSC errors in testing are expected behavior (Next.js cancels in-flight prefetches on navigation). The standalone Docker build is already correct. No infra changes needed.

---

## Layer 1 — Backend DB Schema + New API Endpoints

### Task 1: Add content/tags/collections columns to skills table

**Files:**
- Create: `backend/alembic/versions/0002_skill_rich_fields.py`
- Modify: `backend/app/db/models/skill.py`

**Step 1: Write the migration**

```python
# backend/alembic/versions/0002_skill_rich_fields.py
"""add rich fields to skills and comments table

Revision ID: 0002_skill_rich_fields
Revises: 0001_initial
Create Date: 2026-02-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002_skill_rich_fields"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add rich fields to skills
    op.add_column("skills", sa.Column("content_md", sa.Text(), nullable=True, server_default=""))
    op.add_column("skills", sa.Column("tags", postgresql.ARRAY(sa.Text()), nullable=True, server_default="{}"))
    op.add_column("skills", sa.Column("collections", postgresql.ARRAY(sa.Text()), nullable=True, server_default="{}"))

    # Comments table
    op.create_table(
        "comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("skill_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("author", sa.String(255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_comments_skill_id", "comments", ["skill_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_comments_skill_id", table_name="comments")
    op.drop_table("comments")
    op.drop_column("skills", "collections")
    op.drop_column("skills", "tags")
    op.drop_column("skills", "content_md")
```

**Step 2: Update the Skill ORM model**

```python
# backend/app/db/models/skill.py  — replace entire file
import uuid
from datetime import datetime
from typing import List

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Skill(Base):
    __tablename__ = "skills"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    content_md: Mapped[str] = mapped_column(Text, nullable=True, default="")
    tags: Mapped[List[str]] = mapped_column(ARRAY(Text), nullable=True, default=list)
    collections: Mapped[List[str]] = mapped_column(ARRAY(Text), nullable=True, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    comments: Mapped[list["Comment"]] = relationship("Comment", back_populates="skill", cascade="all, delete-orphan")
```

**Step 3: Run migration**

```bash
cd /path/to/skillnote/backend
docker exec backend-api-1 alembic upgrade head
```
Expected: `Running upgrade 0001_initial -> 0002_skill_rich_fields, add rich fields to skills and comments table`

**Step 4: Commit**

```bash
git add backend/alembic/versions/0002_skill_rich_fields.py backend/app/db/models/skill.py
git commit -m "feat(backend): add content_md, tags, collections columns + comments table"
```

---

### Task 2: Add Comment ORM model + schemas

**Files:**
- Create: `backend/app/db/models/comment.py`
- Modify: `backend/app/db/models/__init__.py`
- Create: `backend/app/schemas/comment.py`

**Step 1: Create Comment model**

```python
# backend/app/db/models/comment.py
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    skill_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("skills.id", ondelete="CASCADE"), nullable=False, index=True)
    author: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    skill: Mapped["Skill"] = relationship("Skill", back_populates="comments")
```

**Step 2: Add Comment to `__init__.py`**

```python
# backend/app/db/models/__init__.py  — add import
from app.db.models.comment import Comment  # add this line
```

**Step 3: Create comment schemas**

```python
# backend/app/schemas/comment.py
from datetime import datetime
from pydantic import BaseModel
import uuid


class CommentOut(BaseModel):
    id: uuid.UUID
    author: str
    body: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CommentCreate(BaseModel):
    author: str
    body: str


class CommentUpdate(BaseModel):
    body: str
```

**Step 4: Commit**

```bash
git add backend/app/db/models/comment.py backend/app/db/models/__init__.py backend/app/schemas/comment.py
git commit -m "feat(backend): add Comment model and schemas"
```

---

### Task 3: Extend skills API — GET detail, POST create, PATCH update, DELETE

**Files:**
- Modify: `backend/app/api/skills.py`
- Modify: `backend/app/schemas/skill.py`

**Step 1: Update schemas**

```python
# backend/app/schemas/skill.py  — replace entire file
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel
import uuid


class SkillListItem(BaseModel):
    name: str
    slug: str
    description: str
    latestVersion: Optional[str] = None
    status: Optional[str] = None
    channel: Optional[str] = None


class SkillDetail(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str
    content_md: Optional[str] = ""
    tags: List[str] = []
    collections: List[str] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SkillCreate(BaseModel):
    name: str
    slug: str
    description: str = ""
    content_md: str = ""
    tags: List[str] = []
    collections: List[str] = []


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    content_md: Optional[str] = None
    tags: Optional[List[str]] = None
    collections: Optional[List[str]] = None
```

**Step 2: Add new routes to `skills.py`**

```python
# backend/app/api/skills.py — add these routes after existing ones

from app.db.models import Skill, SkillVersion, TokenSkillGrant, AccessToken, Comment
from app.schemas.skill import SkillListItem, SkillDetail, SkillCreate, SkillUpdate
import uuid as uuid_lib
from datetime import datetime, timezone

@router.get("/{skill_slug}", response_model=SkillDetail)
def get_skill(
    skill_slug: str,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill_row = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == current_token.id)
        .filter(Skill.slug == skill_slug)
        .first()
    )
    if not skill_row:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")
    return skill_row


@router.post("", response_model=SkillDetail, status_code=201)
def create_skill(
    payload: SkillCreate,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    # Check for duplicate slug
    existing = db.query(Skill).filter(Skill.slug == payload.slug).first()
    if existing:
        raise api_error(409, "SKILL_SLUG_EXISTS", f"Slug '{payload.slug}' already exists")

    skill = Skill(
        id=uuid_lib.uuid4(),
        name=payload.name,
        slug=payload.slug,
        description=payload.description,
        content_md=payload.content_md,
        tags=payload.tags,
        collections=payload.collections,
    )
    db.add(skill)
    db.flush()

    # Auto-grant access to creating token
    grant = TokenSkillGrant(
        id=uuid_lib.uuid4(),
        token_id=current_token.id,
        skill_id=skill.id,
    )
    db.add(grant)
    db.commit()
    db.refresh(skill)
    return skill


@router.patch("/{skill_slug}", response_model=SkillDetail)
def update_skill(
    skill_slug: str,
    payload: SkillUpdate,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill_row = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == current_token.id)
        .filter(Skill.slug == skill_slug)
        .first()
    )
    if not skill_row:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")

    if payload.name is not None:
        skill_row.name = payload.name
    if payload.description is not None:
        skill_row.description = payload.description
    if payload.content_md is not None:
        skill_row.content_md = payload.content_md
    if payload.tags is not None:
        skill_row.tags = payload.tags
    if payload.collections is not None:
        skill_row.collections = payload.collections
    skill_row.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(skill_row)
    return skill_row


@router.delete("/{skill_slug}", status_code=204)
def delete_skill(
    skill_slug: str,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill_row = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == current_token.id)
        .filter(Skill.slug == skill_slug)
        .first()
    )
    if not skill_row:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")

    db.delete(skill_row)
    db.commit()
```

**Step 3: Test via curl**

```bash
curl -s -X POST http://localhost:8082/v1/skills \
  -H "Authorization: Bearer skn_dev_demo_token" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Skill","slug":"test-skill","description":"A test","content_md":"# Hello","tags":["test"],"collections":["Testing"]}' | python3 -m json.tool
```
Expected: JSON with `id`, `slug`, `content_md`, `tags`, `collections`.

```bash
curl -s http://localhost:8082/v1/skills/test-skill \
  -H "Authorization: Bearer skn_dev_demo_token" | python3 -m json.tool
```
Expected: Full skill object including `content_md`.

```bash
curl -s -X DELETE http://localhost:8082/v1/skills/test-skill \
  -H "Authorization: Bearer skn_dev_demo_token" -w "\nHTTP %{http_code}\n"
```
Expected: `HTTP 204`

**Step 4: Commit**

```bash
git add backend/app/api/skills.py backend/app/schemas/skill.py
git commit -m "feat(backend): add GET detail, POST create, PATCH update, DELETE skill endpoints"
```

---

### Task 4: Comments API endpoints

**Files:**
- Create: `backend/app/api/comments.py`
- Modify: `backend/app/main.py`

**Step 1: Create comments router**

```python
# backend/app/api/comments.py
import uuid as uuid_lib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_token
from app.core.errors import api_error
from app.db.models import AccessToken, Skill, TokenSkillGrant
from app.db.models.comment import Comment
from app.db.session import get_db
from app.schemas.comment import CommentCreate, CommentOut, CommentUpdate

router = APIRouter(prefix="/v1/skills/{skill_slug}/comments", tags=["comments"])


def _get_authorized_skill(skill_slug: str, token: AccessToken, db: Session) -> Skill:
    skill = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == token.id)
        .filter(Skill.slug == skill_slug)
        .first()
    )
    if not skill:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")
    return skill


@router.get("", response_model=list[CommentOut])
def list_comments(
    skill_slug: str,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill = _get_authorized_skill(skill_slug, current_token, db)
    return db.query(Comment).filter(Comment.skill_id == skill.id).order_by(Comment.created_at.asc()).all()


@router.post("", response_model=CommentOut, status_code=201)
def create_comment(
    skill_slug: str,
    payload: CommentCreate,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill = _get_authorized_skill(skill_slug, current_token, db)
    comment = Comment(
        id=uuid_lib.uuid4(),
        skill_id=skill.id,
        author=payload.author,
        body=payload.body,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@router.patch("/{comment_id}", response_model=CommentOut)
def update_comment(
    skill_slug: str,
    comment_id: uuid_lib.UUID,
    payload: CommentUpdate,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill = _get_authorized_skill(skill_slug, current_token, db)
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.skill_id == skill.id).first()
    if not comment:
        raise api_error(404, "COMMENT_NOT_FOUND", "Comment not found")
    comment.body = payload.body
    comment.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(comment)
    return comment


@router.delete("/{comment_id}", status_code=204)
def delete_comment(
    skill_slug: str,
    comment_id: uuid_lib.UUID,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill = _get_authorized_skill(skill_slug, current_token, db)
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.skill_id == skill.id).first()
    if not comment:
        raise api_error(404, "COMMENT_NOT_FOUND", "Comment not found")
    db.delete(comment)
    db.commit()
```

**Step 2: Register router in main.py**

```python
# In backend/app/main.py — add after existing router includes:
from app.api.comments import router as comments_router
app.include_router(comments_router)
```

**Step 3: Restart backend and test**

```bash
docker restart backend-api-1
sleep 3
curl -s -X POST http://localhost:8082/v1/skills/api-reviewer/comments \
  -H "Authorization: Bearer skn_dev_demo_token" \
  -H "Content-Type: application/json" \
  -d '{"author":"Rudra","body":"Test comment"}' | python3 -m json.tool
```
Expected: `{"id": "...", "author": "Rudra", "body": "Test comment", ...}`

**Step 4: Commit**

```bash
git add backend/app/api/comments.py backend/app/main.py
git commit -m "feat(backend): add comments CRUD endpoints"
```

---

### Task 5: Tags API endpoints

**Files:**
- Create: `backend/app/api/tags_api.py`
- Modify: `backend/app/main.py`

**Step 1: Create tags router**

```python
# backend/app/api/tags_api.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.api.deps import get_current_token
from app.core.errors import api_error
from app.db.models import AccessToken, Skill, TokenSkillGrant
from app.db.session import get_db
from datetime import datetime, timezone


class TagOut(BaseModel):
    name: str
    skill_count: int


class TagRenameRequest(BaseModel):
    new_name: str


router = APIRouter(prefix="/v1/tags", tags=["tags"])


@router.get("", response_model=list[TagOut])
def list_tags(
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skills = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == current_token.id)
        .all()
    )
    tag_counts: dict[str, int] = {}
    for skill in skills:
        for tag in (skill.tags or []):
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
    return [TagOut(name=name, skill_count=count) for name, count in sorted(tag_counts.items())]


@router.patch("/{tag_name}", response_model=dict)
def rename_tag(
    tag_name: str,
    payload: TagRenameRequest,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skills = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == current_token.id)
        .filter(Skill.tags.contains([tag_name]))
        .all()
    )
    for skill in skills:
        skill.tags = [payload.new_name if t == tag_name else t for t in (skill.tags or [])]
        skill.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"renamed": len(skills), "from": tag_name, "to": payload.new_name}


@router.delete("/{tag_name}", status_code=204)
def delete_tag(
    tag_name: str,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skills = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == current_token.id)
        .filter(Skill.tags.contains([tag_name]))
        .all()
    )
    for skill in skills:
        skill.tags = [t for t in (skill.tags or []) if t != tag_name]
        skill.updated_at = datetime.now(timezone.utc)
    db.commit()
```

**Step 2: Register in main.py**

```python
from app.api.tags_api import router as tags_router
app.include_router(tags_router)
```

**Step 3: Restart and test**

```bash
docker restart backend-api-1 && sleep 3
curl -s http://localhost:8082/v1/tags -H "Authorization: Bearer skn_dev_demo_token" | python3 -m json.tool
```
Expected: Array of `{name, skill_count}` objects.

**Step 4: Commit**

```bash
git add backend/app/api/tags_api.py backend/app/main.py
git commit -m "feat(backend): add tags list, rename, and delete endpoints"
```

---

## Layer 2 — Frontend API Client + Data Layer

### Task 6: Fix API client — remove hardcoded token, add dynamic base URL

**Files:**
- Modify: `src/lib/api/client.ts`

**Replace entire file:**

```typescript
// src/lib/api/client.ts
const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8082'

export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_API_BASE
  return (localStorage.getItem('skillnote:api-url') || DEFAULT_API_BASE).replace(/\/$/, '')
}

export function getAuthToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('skillnote:token') || ''
}

export function isConfigured(): boolean {
  return Boolean(getAuthToken())
}

export type ApiError = {
  code: string
  message: string
}

export class SkillNoteApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken()
  const headers = new Headers(init.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')

  const res = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      code = body?.error?.code || code
      message = body?.error?.message || body?.detail || message
    } catch {}
    throw new SkillNoteApiError(code, message, res.status)
  }
  return res.json() as Promise<T>
}
```

**Commit:**

```bash
git add src/lib/api/client.ts
git commit -m "fix(api): remove hardcoded demo token, add dynamic base URL from localStorage"
```

---

### Task 7: Fix skills API client — full detail fetch, create, update, delete, comments

**Files:**
- Modify: `src/lib/api/skills.ts`

**Replace entire file:**

```typescript
// src/lib/api/skills.ts
import { Skill, Comment } from '@/lib/mock-data'
import { apiRequest } from './client'

type ApiSkillListItem = {
  name: string
  slug: string
  description: string
  latestVersion?: string
}

type ApiSkillDetail = {
  id: string
  name: string
  slug: string
  description: string
  content_md: string
  tags: string[]
  collections: string[]
  created_at: string
  updated_at: string
}

type ApiComment = {
  id: string
  author: string
  body: string
  created_at: string
  updated_at: string
}

function listItemToSkill(item: ApiSkillListItem): Skill {
  const now = new Date().toISOString()
  return {
    slug: item.slug,
    title: item.name,
    description: item.description,
    content_md: '',           // populated by fetchSkill(slug)
    tags: [],
    collections: [],
    created_at: now,
    updated_at: now,
  }
}

function detailToSkill(item: ApiSkillDetail, existingComments?: Comment[]): Skill {
  return {
    slug: item.slug,
    title: item.name,
    description: item.description,
    content_md: item.content_md || '',
    tags: item.tags || [],
    collections: item.collections || [],
    created_at: item.created_at,
    updated_at: item.updated_at,
    comments: existingComments,
  }
}

export async function fetchSkills(): Promise<Skill[]> {
  const list = await apiRequest<ApiSkillListItem[]>('/v1/skills')
  return list.map(listItemToSkill)
}

export async function fetchSkill(slug: string): Promise<Skill> {
  const [detail, comments] = await Promise.all([
    apiRequest<ApiSkillDetail>(`/v1/skills/${slug}`),
    fetchComments(slug).catch(() => [] as Comment[]),
  ])
  return detailToSkill(detail, comments)
}

export async function createSkillApi(data: {
  name: string
  slug: string
  description: string
  content_md: string
  tags: string[]
  collections: string[]
}): Promise<Skill> {
  const detail = await apiRequest<ApiSkillDetail>('/v1/skills', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return detailToSkill(detail)
}

export async function updateSkillApi(slug: string, data: {
  name?: string
  description?: string
  content_md?: string
  tags?: string[]
  collections?: string[]
}): Promise<Skill> {
  const detail = await apiRequest<ApiSkillDetail>(`/v1/skills/${slug}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  return detailToSkill(detail)
}

export async function deleteSkillApi(slug: string): Promise<void> {
  await apiRequest<void>(`/v1/skills/${slug}`, { method: 'DELETE' })
}

// Comments
export async function fetchComments(slug: string): Promise<Comment[]> {
  const list = await apiRequest<ApiComment[]>(`/v1/skills/${slug}/comments`)
  return list.map(c => ({
    id: c.id,
    author: c.author,
    avatar_color: '#6366f1',
    body: c.body,
    created_at: c.created_at,
    reactions: [],
  }))
}

export async function createCommentApi(slug: string, author: string, body: string): Promise<Comment> {
  const c = await apiRequest<ApiComment>(`/v1/skills/${slug}/comments`, {
    method: 'POST',
    body: JSON.stringify({ author, body }),
  })
  return { id: c.id, author: c.author, avatar_color: '#6366f1', body: c.body, created_at: c.created_at, reactions: [] }
}

export async function updateCommentApi(slug: string, commentId: string, body: string): Promise<void> {
  await apiRequest(`/v1/skills/${slug}/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  })
}

export async function deleteCommentApi(slug: string, commentId: string): Promise<void> {
  await apiRequest(`/v1/skills/${slug}/comments/${commentId}`, { method: 'DELETE' })
}

// Tags
export async function fetchTagsApi(): Promise<{ name: string; skill_count: number }[]> {
  return apiRequest('/v1/tags')
}

export async function renameTagApi(oldName: string, newName: string): Promise<void> {
  await apiRequest(`/v1/tags/${encodeURIComponent(oldName)}`, {
    method: 'PATCH',
    body: JSON.stringify({ new_name: newName }),
  })
}

export async function deleteTagApi(name: string): Promise<void> {
  await apiRequest(`/v1/tags/${encodeURIComponent(name)}`, { method: 'DELETE' })
}
```

**Commit:**

```bash
git add src/lib/api/skills.ts
git commit -m "feat(api): add full skill detail, create/update/delete, comments, tags API functions"
```

---

### Task 8: Fix skills-store — offline resilience + full sync

**Files:**
- Modify: `src/lib/skills-store.ts`

**Replace entire file:**

```typescript
// src/lib/skills-store.ts
'use client'

import { Skill } from './mock-data'
import { fetchSkills, fetchSkill, createSkillApi, updateSkillApi, deleteSkillApi } from './api/skills'
import { isConfigured } from './api/client'

const STORAGE_KEY = 'skillnote:skills'

type ConnectionStatus = 'online' | 'offline' | 'unconfigured'
let _connectionStatus: ConnectionStatus = 'unconfigured'
const _listeners: Array<(s: ConnectionStatus) => void> = []

export function getConnectionStatus(): ConnectionStatus {
  return _connectionStatus
}

function setConnectionStatus(s: ConnectionStatus) {
  _connectionStatus = s
  _listeners.forEach(fn => fn(s))
}

export function onConnectionStatusChange(fn: (s: ConnectionStatus) => void) {
  _listeners.push(fn)
  return () => { const i = _listeners.indexOf(fn); if (i !== -1) _listeners.splice(i, 1) }
}

function readStorage(): Skill[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Skill[]
  } catch { return null }
}

function writeStorage(skills: Skill[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(skills)) } catch {}
}

export function getSkills(): Skill[] {
  return readStorage() || []
}

export async function syncSkillsFromApi(): Promise<Skill[]> {
  if (!isConfigured()) {
    setConnectionStatus('unconfigured')
    return getSkills()
  }
  try {
    const skills = await fetchSkills()
    writeStorage(skills)
    setConnectionStatus('online')
    return skills
  } catch {
    setConnectionStatus('offline')
    return getSkills()  // return cache on failure
  }
}

export function saveSkills(skills: Skill[]): void {
  writeStorage(skills)
}

export function addSkill(skill: Skill): void {
  const skills = getSkills()
  skills.unshift(skill)
  writeStorage(skills)
}

export function updateSkill(slug: string, patch: Partial<Skill>): void {
  const skills = getSkills()
  const idx = skills.findIndex(s => s.slug === slug)
  if (idx === -1) return
  skills[idx] = { ...skills[idx], ...patch, updated_at: new Date().toISOString() }
  writeStorage(skills)
}

export function deleteSkill(slug: string): void {
  const skills = getSkills().filter(s => s.slug !== slug)
  writeStorage(skills)
}

export function clearAndReseed(): void {
  localStorage.removeItem(STORAGE_KEY)
}

// Create skill: write to backend then update local cache
export async function createSkill(data: {
  title: string
  description: string
  content_md: string
  tags: string[]
  collections: string[]
}): Promise<Skill> {
  const slug = data.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (isConfigured()) {
    const skill = await createSkillApi({ name: data.title, slug, ...data })
    addSkill(skill)
    return skill
  } else {
    // localStorage-only when not configured
    const now = new Date().toISOString()
    const skill: Skill = { slug, title: data.title, description: data.description, content_md: data.content_md, tags: data.tags, collections: data.collections, created_at: now, updated_at: now }
    addSkill(skill)
    return skill
  }
}

// Delete skill: remove from backend then from cache
export async function deleteSkillById(slug: string): Promise<void> {
  if (isConfigured()) {
    await deleteSkillApi(slug)
  }
  deleteSkill(slug)
}

// Save edit: update backend then cache
export async function saveSkillEdit(slug: string, patch: { title?: string; content_md?: string; tags?: string[]; collections?: string[] }): Promise<void> {
  if (isConfigured()) {
    await updateSkillApi(slug, { name: patch.title, content_md: patch.content_md, tags: patch.tags, collections: patch.collections })
  }
  updateSkill(slug, patch)
}
```

**Commit:**

```bash
git add src/lib/skills-store.ts
git commit -m "feat(store): add offline resilience, connection status, createSkill/deleteSkillById/saveSkillEdit"
```

---

## Layer 3 — Core CRUD UI Components

### Task 9: Connection status banner

**Files:**
- Create: `src/components/layout/connection-banner.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Step 1: Create connection banner**

```tsx
// src/components/layout/connection-banner.tsx
'use client'
import { useEffect, useState } from 'react'
import { WifiOff, Settings2, X } from 'lucide-react'
import Link from 'next/link'
import { getConnectionStatus, onConnectionStatusChange } from '@/lib/skills-store'

export function ConnectionBanner() {
  const [status, setStatus] = useState(getConnectionStatus())
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    return onConnectionStatusChange(setStatus)
  }, [])

  if (dismissed || status === 'online') return null

  if (status === 'unconfigured') {
    return (
      <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center gap-2 text-[12px] text-amber-700 dark:text-amber-400">
        <Settings2 className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Backend not configured. <Link href="/settings" className="underline font-medium">Add your API token in Settings</Link> to sync skills.</span>
        <button onClick={() => setDismissed(true)} className="p-0.5 hover:opacity-70"><X className="h-3 w-3" /></button>
      </div>
    )
  }

  if (status === 'offline') {
    return (
      <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 flex items-center gap-2 text-[12px] text-red-700 dark:text-red-400">
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Backend unreachable — showing cached data.</span>
        <button onClick={() => setDismissed(true)} className="p-0.5 hover:opacity-70"><X className="h-3 w-3" /></button>
      </div>
    )
  }

  return null
}
```

**Step 2: Add to layout**

In `src/app/(app)/layout.tsx`, inside the `content-wrapper` div, add `<ConnectionBanner />` before `{children}`:

```tsx
import { ConnectionBanner } from '@/components/layout/connection-banner'
// ...
<div className="content-wrapper flex-1 ml-0 lg:ml-[220px] flex flex-col min-h-screen overflow-hidden dot-grid pb-16 lg:pb-0">
  <ConnectionBanner />
  {children}
</div>
```

**Commit:**

```bash
git add src/components/layout/connection-banner.tsx src/app/(app)/layout.tsx
git commit -m "feat(ui): add connection status banner for unconfigured/offline states"
```

---

### Task 10: Backend config in Settings

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`

**Step 1: Add a "Backend" section** — Add this before the "About" section in `settings/page.tsx`:

```tsx
// Add imports at top:
import { useState as useBackendState } from 'react' // already imported as useState
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
// Add these to existing imports from lucide-react

// New BackendConfig component — add before SettingsPage:
function BackendConfig() {
  const [apiUrl, setApiUrl] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('skillnote:api-url') || '') : ''
  )
  const [token, setToken] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('skillnote:token') || '') : ''
  )
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'idle' | 'ok' | 'fail'>('idle')

  function save() {
    localStorage.setItem('skillnote:api-url', apiUrl.trim())
    localStorage.setItem('skillnote:token', token.trim())
    toast.success('Backend config saved — reload to reconnect')
  }

  async function testConnection() {
    setTesting(true)
    setTestResult('idle')
    try {
      const base = (apiUrl.trim() || 'http://localhost:8082').replace(/\/$/, '')
      const res = await fetch(`${base}/auth/validate-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      const data = await res.json()
      setTestResult(data.valid ? 'ok' : 'fail')
    } catch {
      setTestResult('fail')
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <Row label="API Base URL" desc="URL of your SkillNote backend (e.g. http://localhost:8082)">
        <input
          type="url"
          value={apiUrl}
          onChange={e => setApiUrl(e.target.value)}
          placeholder="http://localhost:8082"
          className="h-8 px-3 text-[13px] bg-muted border border-border/60 rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-56"
        />
      </Row>
      <Row label="Access Token" desc="Bearer token for API authentication">
        <input
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="skn_live_..."
          className="h-8 px-3 text-[13px] bg-muted border border-border/60 rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-56"
        />
      </Row>
      <Row label="Connection" desc="Validate token against the backend">
        <div className="flex items-center gap-2">
          {testResult === 'ok' && <span className="flex items-center gap-1 text-[12px] text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Connected</span>}
          {testResult === 'fail' && <span className="flex items-center gap-1 text-[12px] text-destructive"><XCircle className="h-3.5 w-3.5" /> Failed</span>}
          <button
            onClick={testConnection}
            disabled={testing || !token}
            className="flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium bg-muted hover:bg-muted-foreground/15 border border-border/60 rounded-lg text-foreground transition-colors disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Test Connection
          </button>
          <button
            onClick={save}
            className="flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90 rounded-lg transition-colors"
          >
            Save
          </button>
        </div>
      </Row>
    </>
  )
}
```

**Step 2: Add section to render**

In `SettingsPage`, add before the `{/* About */}` section:

```tsx
<Section title="Backend">
  <BackendConfig />
</Section>
```

**Step 3: Fix Reset handler** — Replace `localStorage.clear()` with targeted clear:

```tsx
const handleReset = useCallback(() => {
  if (window.confirm('Reset all local preferences and reload? This cannot be undone.')) {
    // Clear preferences only — preserve skills cache and backend config
    const preserve = ['skillnote:skills', 'skillnote:token', 'skillnote:api-url', 'skillnote:collections-meta']
    const toRemove = Object.keys(localStorage).filter(k => !preserve.includes(k) && k.startsWith('skillnote:'))
    toRemove.forEach(k => localStorage.removeItem(k))
    window.location.reload()
  }
}, [])
```

**Step 4: Fix Settings links**

```tsx
<a href="https://github.com/luna-prompts/skillnote" target="_blank" rel="noopener noreferrer" className="...">
  View on GitHub <ExternalLink className="h-3 w-3" />
</a>
<a href="https://github.com/luna-prompts/skillnote#readme" target="_blank" rel="noopener noreferrer" className="...">
  Documentation <ExternalLink className="h-3 w-3" />
</a>
```

**Commit:**

```bash
git add src/app/(app)/settings/page.tsx
git commit -m "feat(ui): add backend config section, fix reset handler, fix settings links"
```

---

### Task 11: New Skill modal

**Files:**
- Create: `src/components/skills/NewSkillModal.tsx`
- Modify: `src/components/layout/topbar.tsx`
- Modify: `src/app/(app)/page.tsx`

**Step 1: Create NewSkillModal**

```tsx
// src/components/skills/NewSkillModal.tsx
'use client'
import { useState, useCallback, KeyboardEvent } from 'react'
import { Plus, X, BookOpen, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createSkill } from '@/lib/skills-store'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

type NewSkillModalProps = {
  onClose: () => void
  collections: string[]
}

export function NewSkillModal({ onClose, collections }: NewSkillModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [selectedCollections, setSelectedCollections] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  const addTag = useCallback(() => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTagInput('')
  }, [tagInput, tags])

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() }
    if (e.key === 'Backspace' && !tagInput && tags.length) setTags(prev => prev.slice(0, -1))
  }

  const toggleCollection = (name: string) =>
    setSelectedCollections(prev => prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name])

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) { toast.error('Title is required'); return }
    setSaving(true)
    try {
      const skill = await createSkill({
        title: title.trim(),
        description: description.trim(),
        content_md: `# ${title.trim()}\n\n`,
        tags,
        collections: selectedCollections,
      })
      toast.success(`Skill "${skill.title}" created`)
      onClose()
      router.push(`/skills/${skill.slug}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create skill')
    } finally {
      setSaving(false)
    }
  }, [title, description, tags, selectedCollections, router, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            New Skill
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Title <span className="text-destructive">*</span></label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="e.g. React Hooks Guide"
              className="w-full h-9 px-3 text-[13px] bg-muted/60 border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/60"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of this skill"
              className="w-full h-9 px-3 text-[13px] bg-muted/60 border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/60"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Tags</label>
            <div className="flex flex-wrap gap-1.5 p-2 bg-muted/60 border border-border/60 rounded-lg min-h-[36px]">
              {tags.map(tag => (
                <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent text-[11px] font-mono rounded-md">
                  {tag}
                  <button onClick={() => setTags(prev => prev.filter(t => t !== tag))} className="hover:opacity-70"><X className="h-2.5 w-2.5" /></button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
                placeholder={tags.length === 0 ? 'type tag + Enter' : ''}
                className="flex-1 min-w-[80px] bg-transparent text-[12px] font-mono focus:outline-none placeholder:text-muted-foreground/50"
              />
            </div>
          </div>

          {/* Collections */}
          {collections.length > 0 && (
            <div>
              <label className="block text-[12px] font-medium text-foreground mb-1.5">Collection</label>
              <div className="flex flex-wrap gap-1.5">
                {collections.map(col => (
                  <button
                    key={col}
                    onClick={() => toggleCollection(col)}
                    className={`px-2.5 py-1 rounded-lg text-[12px] border transition-colors ${
                      selectedCollections.includes(col)
                        ? 'bg-accent/10 text-accent border-accent/30'
                        : 'bg-muted text-muted-foreground border-border/60 hover:text-foreground'
                    }`}
                  >
                    {col}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border/60 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="h-8 text-[13px]" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="h-8 text-[13px] gap-1.5 bg-foreground text-background hover:bg-foreground/90"
            disabled={!title.trim() || saving}
            onClick={handleSubmit}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create Skill
          </Button>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Wire "New Skill" button in topbar**

In `src/components/layout/topbar.tsx`:
1. Add import: `import { NewSkillModal } from '@/components/skills/NewSkillModal'`
2. Add state: `const [newSkillOpen, setNewSkillOpen] = useState(false)`
3. Add state for collections derived from skills: `const [availableCollections, setAvailableCollections] = useState<string[]>([])`
4. In the `useEffect` that calls `syncSkillsFromApi`, also update collections:
   ```ts
   useEffect(() => {
     syncSkillsFromApi().then(skills => {
       const cols = [...new Set(skills.flatMap(s => s.collections || []))]
       setAvailableCollections(cols)
     }).catch(() => {})
   }, [])
   ```
5. Add `onClick={() => setNewSkillOpen(true)}` to the desktop "New Skill" Button (line 174)
6. Add `onClick={() => setNewSkillOpen(true)}` to the mobile FAB button (line 195)
7. Add keyboard shortcut in the existing `useEffect` for keydown:
   ```ts
   if (e.key === 'n' && !inInput && !e.metaKey && !e.ctrlKey) {
     e.preventDefault()
     setNewSkillOpen(true)
   }
   ```
   (Add this handler to the topbar keydown listener, checking `!inInput`)
8. Render modal at end of component (alongside ImportModal):
   ```tsx
   {newSkillOpen && (
     <NewSkillModal
       onClose={() => setNewSkillOpen(false)}
       collections={availableCollections}
     />
   )}
   ```

**Commit:**

```bash
git add src/components/skills/NewSkillModal.tsx src/components/layout/topbar.tsx
git commit -m "feat(ui): implement New Skill modal with title/description/tags/collection"
```

---

### Task 12: Delete skill

**Files:**
- Modify: `src/components/skills/skill-detail.tsx`

**Step 1: Add delete to the `⋯` More menu**

In `skill-detail.tsx`:
1. Import: `import { deleteSkillById } from '@/lib/skills-store'` and `import { Trash2 } from 'lucide-react'`
2. Add state: `const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)`
3. Add handler:
   ```ts
   const handleDelete = useCallback(async () => {
     try {
       await deleteSkillById(skill.slug)
       toast.success(`"${skill.title}" deleted`)
       router.push('/')
     } catch {
       toast.error('Failed to delete skill')
     }
   }, [skill.slug, skill.title, router])
   ```
4. Add to `⋯` More menu (after existing items):
   ```tsx
   <div className="border-t border-border/60 my-1" />
   <button
     onClick={() => { setShowDeleteConfirm(true); setShowMoreMenu(false) }}
     className="flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-destructive/10 w-full text-left text-destructive min-h-[44px] sm:min-h-[36px]"
   >
     <Trash2 className="h-3.5 w-3.5" />
     Delete Skill
   </button>
   ```
5. Add confirm dialog (alongside existing `showDiscardConfirm` dialog):
   ```tsx
   {showDeleteConfirm && (
     <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowDeleteConfirm(false)}>
       <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
         <h3 className="text-sm font-semibold text-foreground mb-2">Delete "{skill.title}"?</h3>
         <p className="text-[13px] text-muted-foreground mb-5">This will permanently delete the skill. This cannot be undone.</p>
         <div className="flex justify-end gap-2">
           <Button variant="outline" size="sm" className="h-8 text-[13px]" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
           <Button variant="destructive" size="sm" className="h-8 text-[13px]" onClick={handleDelete}>Delete</Button>
         </div>
       </div>
     </div>
   )}
   ```

**Commit:**

```bash
git add src/components/skills/skill-detail.tsx
git commit -m "feat(ui): add Delete Skill with confirmation dialog"
```

---

### Task 13: Wire comment submit to backend

**Files:**
- Modify: `src/components/skills/tabs/SkillCommentsTab.tsx`
- Modify: `src/components/skills/tabs/SkillViewTab.tsx`
- Modify: `src/app/(app)/skills/[slug]/page.tsx`

**Step 1: Update `CommentInput` to accept and use `onSubmit`**

In `SkillCommentsTab.tsx`, update `CommentInput`:
1. Add `onSubmitComment?: (body: string) => Promise<void>` to props
2. Add `submitting` state
3. Wire the "Comment" Button:
   ```tsx
   <Button
     size="sm"
     className="h-8 ... gap-1.5"
     disabled={submitting || !value.trim()}
     onClick={async () => {
       if (!value.trim()) return
       setSubmitting(true)
       try {
         await onSubmitComment?.(value)
         setValue('')
       } finally {
         setSubmitting(false)
       }
     }}
   >
     {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
     Comment
   </Button>
   ```
4. Wire `Ctrl+Enter` to the same handler

**Step 2: Update `SkillCommentsTab` to pass handler**

Update `SkillCommentsTab` to accept `onAddComment?: (body: string) => Promise<void>` prop and pass to `CommentInput`.

**Step 3: Update `SkillViewTab` to pass handler**

In `SkillViewTab`, accept `onAddComment?: (body: string) => Promise<void>` and pass to `SkillCommentsTab`.

**Step 4: Update `skill-detail.tsx` to provide handler**

```tsx
import { createCommentApi } from '@/lib/api/skills'

const handleAddComment = useCallback(async (body: string) => {
  const comment = await createCommentApi(skill.slug, 'You', body)
  updateSkill(skill.slug, { comments: [...(skill.comments || []), comment] })
  toast.success('Comment added')
}, [skill.slug, skill.comments])
```

Pass to `SkillViewTab`: `<SkillViewTab skill={skill} onAddComment={handleAddComment} />`

**Step 5: Wire comment Edit/Delete**

In `CommentCard`, update Edit/Delete handlers to call `updateCommentApi`/`deleteCommentApi`:

```tsx
import { updateCommentApi, deleteCommentApi } from '@/lib/api/skills'

// In CommentCard, add props: skillSlug and onDeleted
// Delete handler:
async function handleDelete() {
  await deleteCommentApi(skillSlug, comment.id)
  onDeleted?.()
  setShowMenu(false)
}
// Edit handler: show inline input, call updateCommentApi on save
```

**Commit:**

```bash
git add src/components/skills/tabs/SkillCommentsTab.tsx src/components/skills/tabs/SkillViewTab.tsx src/components/skills/skill-detail.tsx
git commit -m "feat(ui): wire comment submit/edit/delete to backend API"
```

---

### Task 14: Tag rename and delete (functional)

**Files:**
- Modify: `src/app/(app)/tags/page.tsx`

**Step 1: Replace Rename/Delete buttons with working implementations**

```tsx
// In TagsPage, add state for rename modal:
const [renamingTag, setRenamingTag] = useState<string | null>(null)
const [renameValue, setRenameValue] = useState('')
const [deletingTag, setDeletingTag] = useState<string | null>(null)

// Rename handler:
async function handleRename() {
  if (!renamingTag || !renameValue.trim()) return
  try {
    await renameTagApi(renamingTag, renameValue.trim())
    // Update all skills in localStorage
    const updated = skills.map(s => ({
      ...s,
      tags: (s.tags || []).map(t => t === renamingTag ? renameValue.trim() : t)
    }))
    saveSkills(updated)
    setSkills(updated)
    toast.success(`Tag renamed to "${renameValue.trim()}"`)
    setRenamingTag(null)
  } catch {
    toast.error('Failed to rename tag')
  }
}

// Delete handler:
async function handleDelete() {
  if (!deletingTag) return
  try {
    await deleteTagApi(deletingTag)
    const updated = skills.map(s => ({
      ...s,
      tags: (s.tags || []).filter(t => t !== deletingTag)
    }))
    saveSkills(updated)
    setSkills(updated)
    toast.success(`Tag "${deletingTag}" deleted`)
    setDeletingTag(null)
  } catch {
    toast.error('Failed to delete tag')
  }
}
```

Replace static Rename/Delete buttons:
```tsx
// Rename button:
<button onClick={() => { setRenamingTag(tag.name); setRenameValue(tag.name) }} className="...">Rename</button>
// Delete button:
<button onClick={() => setDeletingTag(tag.name)} className="...text-destructive...">Delete</button>
```

Add rename inline modal and delete confirm modal at bottom of component.

**Step 2: Add mobile card list** (below `sm` screens):

```tsx
{/* Mobile list — shown only below sm */}
<div className="sm:hidden space-y-2">
  {filtered.map((tag, i) => (
    <div key={tag.id} className="flex items-center justify-between p-3 bg-card border border-border/60 rounded-lg">
      <div className="flex items-center gap-2">
        <span className={cn('w-2 h-2 rounded-full shrink-0', TAG_COLORS[i % TAG_COLORS.length])} />
        <span className="font-mono text-[13px] font-medium">{tag.name}</span>
        <span className="text-[11px] text-muted-foreground">{tag.skill_count}</span>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => { setRenamingTag(tag.name); setRenameValue(tag.name) }} className="text-[12px] text-muted-foreground hover:text-foreground">Rename</button>
        <button onClick={() => setDeletingTag(tag.name)} className="text-[12px] text-destructive/70 hover:text-destructive">Delete</button>
      </div>
    </div>
  ))}
</div>
```

**Commit:**

```bash
git add src/app/(app)/tags/page.tsx
git commit -m "feat(ui): implement tag rename/delete with backend sync + mobile card view"
```

---

### Task 15: New Collection modal

**Files:**
- Create: `src/components/collections/NewCollectionModal.tsx`
- Modify: `src/app/(app)/collections/page.tsx`
- Modify: `src/lib/derived.ts`

**Step 1: Create NewCollectionModal**

```tsx
// src/components/collections/NewCollectionModal.tsx
'use client'
import { useState } from 'react'
import { FolderOpen, Plus, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

const COLORS = ['#8b5cf6', '#3b82f6', '#14b8a6', '#f59e0b', '#f43f5e']

type Props = { onClose: () => void; onCreated: (name: string, description: string) => void }

export function NewCollectionModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try {
      // Store in localStorage meta
      const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
      meta[name.trim()] = { description: description.trim(), created_at: new Date().toISOString() }
      localStorage.setItem('skillnote:collections-meta', JSON.stringify(meta))
      onCreated(name.trim(), description.trim())
      toast.success(`Collection "${name.trim()}" created`)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl overflow-hidden mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <h3 className="text-sm font-semibold flex items-center gap-2"><FolderOpen className="h-4 w-4 text-muted-foreground" />New Collection</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Name <span className="text-destructive">*</span></label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} placeholder="e.g. Frontend" className="w-full h-9 px-3 text-[13px] bg-muted/60 border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/60" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What skills belong here?" className="w-full h-9 px-3 text-[13px] bg-muted/60 border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/60" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-border/60 flex justify-end gap-2">
          <Button variant="outline" size="sm" className="h-8 text-[13px]" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-8 text-[13px] gap-1.5 bg-foreground text-background hover:bg-foreground/90" disabled={!name.trim() || saving} onClick={handleCreate}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create
          </Button>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Update `derived.ts` to merge localStorage meta**

```typescript
// src/lib/derived.ts — update deriveCollections
export function deriveCollections(skills: Skill[]) {
  const map = new Map<string, { count: number; updatedAt: string }>()
  for (const s of skills) {
    for (const c of s.collections || []) {
      const cur = map.get(c) || { count: 0, updatedAt: s.updated_at }
      map.set(c, { count: cur.count + 1, updatedAt: s.updated_at > cur.updatedAt ? s.updated_at : cur.updatedAt })
    }
  }

  // Merge meta collections (created but may have 0 skills)
  if (typeof window !== 'undefined') {
    try {
      const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
      for (const [name, data] of Object.entries(meta as Record<string, { description: string; created_at: string }>)) {
        if (!map.has(name)) map.set(name, { count: 0, updatedAt: data.created_at })
      }
    } catch {}
  }

  return Array.from(map.entries()).map(([name, { count, updatedAt }], i) => {
    const meta = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')[name] : null
    return {
      id: String(i + 1),
      name,
      description: meta?.description || `${name} skills`,
      skill_count: count,
      updated_at: updatedAt,
    }
  })
}
```

**Step 3: Wire New Collection button in collections page**

In `collections/page.tsx`:
1. Add `import { NewCollectionModal } from '@/components/collections/NewCollectionModal'`
2. Add state: `const [newCollectionOpen, setNewCollectionOpen] = useState(false)`
3. Un-disable the button and add `onClick={() => setNewCollectionOpen(true)}`
4. Handle `onCreated`: re-derive collections from updated skills list
5. Render modal

**Step 4: Fix collection slug case-sensitivity**

In `collections/[slug]/page.tsx`, change case-insensitive match:
```tsx
// Replace:
const filtered = useMemo(() => skills.filter(s => (s.collections || []).includes(collectionName)), [skills, collectionName])
// With:
const filtered = useMemo(() => {
  const nameLower = collectionName.toLowerCase()
  return skills.filter(s => (s.collections || []).some(c => c.toLowerCase() === nameLower))
}, [skills, collectionName])
```

Also in `collections/page.tsx`, use proper slug that matches:
```tsx
// Keep case-insensitive slug generation consistent:
const slug = encodeURIComponent(col.name.toLowerCase().replace(/\s+/g, '-'))
```

**Commit:**

```bash
git add src/components/collections/NewCollectionModal.tsx src/app/(app)/collections/page.tsx src/app/(app)/collections/[slug]/page.tsx src/lib/derived.ts
git commit -m "feat(ui): add New Collection modal, fix collection slug case-insensitive matching"
```

---

## Layer 4 — UI Polish

### Task 16: Fix 404 page with app shell

**Files:**
- Modify: `src/app/(app)/not-found.tsx`

**Replace entire file:**

```tsx
// src/app/(app)/not-found.tsx
'use client'
import Link from 'next/link'
import { TopBar } from '@/components/layout/topbar'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <>
      <TopBar showFab={false} />
      <main className="flex-1 flex flex-col items-center justify-center py-24 px-6">
        <div className="w-14 h-14 rounded-2xl bg-muted/80 flex items-center justify-center mb-5">
          <FileQuestion className="h-7 w-7 text-muted-foreground/60" />
        </div>
        <h1 className="text-[18px] font-semibold text-foreground mb-2">Page not found</h1>
        <p className="text-[13px] text-muted-foreground text-center max-w-xs mb-6">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Button asChild size="sm" className="h-8 text-[13px] bg-foreground text-background hover:bg-foreground/90">
          <Link href="/">Go to Skills</Link>
        </Button>
      </main>
    </>
  )
}
```

**Commit:**

```bash
git add src/app/(app)/not-found.tsx
git commit -m "fix(ui): add app shell to 404 not-found page"
```

---

### Task 17: Remove fake presence avatars

**Files:**
- Modify: `src/components/skills/skill-detail.tsx`

**Step 1: Replace the presence avatars block** (lines ~302-324) with a simple "last edited" chip:

```tsx
{/* Replace presence block with: */}
<div className="hidden xl:flex items-center gap-2">
  <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[8px] font-bold text-accent">
    {skill.title.charAt(0).toUpperCase()}
  </div>
  <span className="text-[11px] text-muted-foreground">
    Last edited {formatRelative(skill.updated_at)}
  </span>
</div>
```

Also remove `mockTeamMembers` import from `SkillCommentsTab.tsx` (it's still imported there for `@mention` suggestions) — replace `mockTeamMembers` with an empty array or a local stub.

**Commit:**

```bash
git add src/components/skills/skill-detail.tsx src/components/skills/tabs/SkillCommentsTab.tsx
git commit -m "fix(ui): remove hardcoded fake presence avatars, show real last-edited info"
```

---

### Task 18: History empty state + skill detail full content fetch

**Files:**
- Modify: `src/components/skills/tabs/SkillHistoryTab.tsx`
- Modify: `src/app/(app)/skills/[slug]/page.tsx`

**Step 1: Add proper empty state in SkillHistoryTab**

Replace the existing empty state (whatever it shows for 0 revisions) with:

```tsx
// When revisions.length === 0:
<div className="flex flex-col items-center justify-center py-16 px-6">
  <div className="w-12 h-12 rounded-xl bg-muted/80 flex items-center justify-center mb-4">
    <History className="h-6 w-6 text-muted-foreground/50" />
  </div>
  <p className="text-[14px] font-medium text-foreground mb-1">No revision history yet</p>
  <p className="text-[13px] text-muted-foreground text-center max-w-xs">
    Revision history will appear here as the skill is edited and saved.
  </p>
</div>
```

**Step 2: Load full skill content in skill page**

In `src/app/(app)/skills/[slug]/page.tsx`, update `useEffect` to fetch full detail:

```tsx
import { fetchSkill } from '@/lib/api/skills'
import { isConfigured } from '@/lib/api/client'

useEffect(() => {
  // First try full detail fetch for rich content
  if (isConfigured()) {
    fetchSkill(slug)
      .then(fullSkill => {
        setSkill(fullSkill)
        updateSkill(slug, fullSkill) // update cache with full content
      })
      .catch(() => {
        // Fallback: use syncSkillsFromApi (list only)
        syncSkillsFromApi()
          .then(skills => setSkill(skills.find(s => s.slug === slug) ?? null))
          .catch(() => {})
      })
  } else {
    syncSkillsFromApi()
      .then(skills => setSkill(skills.find(s => s.slug === slug) ?? null))
      .catch(() => {})
  }
}, [slug])
```

**Commit:**

```bash
git add src/components/skills/tabs/SkillHistoryTab.tsx src/app/(app)/skills/[slug]/page.tsx
git commit -m "fix(ui): add history empty state, fetch full skill content from API"
```

---

### Task 19: Save skill edits to backend

**Files:**
- Modify: `src/components/skills/skill-detail.tsx`

**Step 1: Update `handleSave` to use `saveSkillEdit`**

```tsx
import { saveSkillEdit } from '@/lib/skills-store'

const handleSave = useCallback(async () => {
  setSaveToast('saving')
  try {
    await saveSkillEdit(skill.slug, { title: titleValue, content_md: editorContent })
    setSaveToast('saved')
    setActiveTab('view')
    setTimeout(() => setSaveToast(false), 1500)
  } catch {
    setSaveToast(false)
    toast.error('Failed to save')
  }
}, [skill.slug, titleValue, editorContent])
```

**Commit:**

```bash
git add src/components/skills/skill-detail.tsx
git commit -m "fix(ui): wire skill save to backend PATCH endpoint"
```

---

### Task 20: Final polish — rebuild Docker, verify E2E

**Step 1: Rebuild Docker image**

```bash
cd /path/to/skillnote
docker build -t skillnote-prod . && docker stop skillnote && docker run -d --rm -p 3000:3000 --name skillnote skillnote-prod
```

**Step 2: Restart backend**

```bash
docker restart backend-api-1
```

**Step 3: Run quick Playwright smoke test**

```bash
node test-e2e-deep.mjs 2>&1 | grep -E "(ISSUE|=== |URL:|Skill links|Backend)"
```

Expected: No HIGH/CRITICAL issues. Skills list loads from backend. New Skill modal opens.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: production-ready — all 32 bugs fixed and features implemented"
```

---

## Summary Checklist

| Task | Layer | Status |
|------|-------|--------|
| 1. DB migration: content_md, tags, collections, comments table | L1 | ⬜ |
| 2. Comment ORM model + schemas | L1 | ⬜ |
| 3. Skills API: GET detail, POST, PATCH, DELETE | L1 | ⬜ |
| 4. Comments API endpoints | L1 | ⬜ |
| 5. Tags API endpoints | L1 | ⬜ |
| 6. Fix API client (remove hardcoded token, dynamic base URL) | L2 | ⬜ |
| 7. Fix skills API client (full detail fetch, CRUD, comments, tags) | L2 | ⬜ |
| 8. Fix skills-store (offline resilience, createSkill, deleteSkillById, saveSkillEdit) | L2 | ⬜ |
| 9. Connection status banner | L3 | ⬜ |
| 10. Backend config in Settings (URL + token + test connection + fix reset + fix links) | L3 | ⬜ |
| 11. New Skill modal + keyboard shortcut N | L3 | ⬜ |
| 12. Delete Skill with confirmation | L3 | ⬜ |
| 13. Wire comment submit/edit/delete to backend | L3 | ⬜ |
| 14. Tag rename/delete (functional) + mobile tag cards | L3 | ⬜ |
| 15. New Collection modal + case-insensitive slug fix | L3 | ⬜ |
| 16. 404 page with app shell | L4 | ⬜ |
| 17. Remove fake presence avatars | L4 | ⬜ |
| 18. History empty state + full skill content fetch | L4 | ⬜ |
| 19. Save skill edits to backend | L4 | ⬜ |
| 20. Rebuild Docker + E2E verify | L4 | ⬜ |
