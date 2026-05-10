# SkillNote ↔ OpenClaw v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SkillNote the OpenClaw agent's home for skills. Ship a single self-bootstrapping skill called `skillnote` (published to ClawHub) that grafts a small awareness block into the agent's `AGENTS.md`, plus a thin backend that absorbs invocation logging and agent-authored comments, plus one web UI page so humans can see what their agent is doing.

**Architecture (the whole thing in one breath):** The product is a single SKILL.md. On first load the agent runs the skill's bootstrap section, which appends `<skillnote v1>...</skillnote>` to `~/.openclaw/workspace/AGENTS.md`. From that point every OpenClaw session wakes up already aware of SkillNote — no plugin, no SDK pin, no separate setup. The agent calls SkillNote APIs to log invocations, leave comments (with `author_type=agent`), and surface drift via comments tagged `[drift]`. The human visits `/me/activity` to see what the agent has been doing. The marketplace stays at ClawHub; SkillNote does not duplicate search.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Pydantic 2, Next.js 16, React 19, TypeScript. Plus careful markdown for the actual product.

**Release:** 0.4.0 (branch: `feat/skillnote-openclaw-v1`)

**Owner:** @latentloop07

---

## File Structure

**Backend (created):**
- `backend/seed_data/skillnote.skill/SKILL.md` — **the product** (~250 lines markdown, includes bootstrap section + deep operations manual)
- `backend/seed_data/skillnote.skill/VERSION` — single line, semver, e.g. `1.0.0`
- `backend/alembic/versions/0015_comments_author_type.py` — migration
- `backend/alembic/versions/0016_skill_invocations.py` — migration
- `backend/app/db/models/skill_invocation.py` — SQLAlchemy model
- `backend/app/schemas/skill_invocation.py` — Pydantic schemas
- `backend/app/schemas/activity.py` — `/me/activity` response schemas
- `backend/app/api/invocations.py` — `POST /v1/skills/<slug>/invocations`
- `backend/app/api/me.py` — `GET /v1/me/activity`
- `backend/app/api/openclaw.py` — `GET /v1/openclaw-skill`
- `backend/tests/integration/test_invocations_api.py`
- `backend/tests/integration/test_me_activity_api.py`
- `backend/tests/integration/test_openclaw_skill_api.py`

**Backend (modified):**
- `backend/app/db/models/comment.py` — add `author_type` enum column
- `backend/app/db/models/__init__.py` — register `SkillInvocation`
- `backend/app/schemas/comment.py` — surface `author_type` in `CommentOut` + `CommentCreate`
- `backend/app/main.py` — wire new routers (`invocations`, `me`, `openclaw`)
- `backend/app/api/setup.py` — extend with `agent=openclaw` query param

**Frontend (created):**
- `src/lib/api/activity.ts` — typed client for `/me/activity`
- `src/app/(app)/me/activity/page.tsx` — agent activity feed
- `src/components/me/ActivityFeed.tsx` — feed renderer
- `src/components/me/TopSkillsCard.tsx` — top-N skills used by the agent
- `src/components/me/AgentCommentsCard.tsx` — agent-authored comments grouped by skill
- `src/components/settings/ConnectOpenClawCard.tsx` — generates the `clawhub install skillnote` one-liner + curl-bash for self-hosted + QR

**Frontend (modified):**
- `src/app/(app)/settings/page.tsx` — mount `ConnectOpenClawCard`
- `src/components/skills/SkillCommentsTab.tsx` — render agent-authored comments with a distinct badge
- `src/lib/types.ts` — add `author_type` to `Comment` type
- `cli/src/agents/openclaw.ts` — fix the broken skill path (currently writes to `PROJECT/skills/`, should be `~/.openclaw/skills/skillnote-<slug>/`)

**Release artifacts:**
- `package.json` — version bump 0.3.4 → 0.4.0
- `CHANGELOG.md` — 0.4.0 entry
- `README.md` — add "OpenClaw" section under Integrations; flip the "Planned" status

---

## Design Decisions (Locked)

- **One product, one file.** The `skillnote` skill body is the entire integration. No plugin, no agent:bootstrap hook, no separate install script. The skill grafts itself into AGENTS.md on first load; bootstrap is idempotent and self-healing.
- **Marker discipline.** AGENTS.md graft uses `<skillnote v1>` ... `</skillnote>`. The `v1` is the forward-compat hook — future v2 schemas migrate via marker swap.
- **Reuse comments, don't add `skill_reflections`.** Agent-authored reflections / commentary / drift signals all use the existing `comments` table with `author_type='agent'`. Drift is a comment whose body starts with `[drift]`. **No new "reflections" or "drift_signals" tables in v1.** P4 (DRY).
- **Invocations are append-only, fire-and-forget.** `POST /v1/skills/<slug>/invocations` returns 202 with no body. Failures never block the agent.
- **No marketplace search inside SkillNote.** ClawHub does that. The agent uses `clawhub search` directly and reports clones via comment. v1 doesn't track clones server-side.
- **Address resolution.** Solo install (`clawhub install skillnote`) defaults to the SkillNote-hosted free tier (host = `https://skillnote.app`, configurable via env var on the SkillNote backend that serves the seed skill). Self-hosted/team install uses a curl-bash one-liner from `GET /v1/setup?agent=openclaw&token=<token>` that writes `~/.openclaw/skills/skillnote/config.json` with the host pre-baked AND runs `clawhub install skillnote`. **The `openclaw://bind/<team>` deep link is deferred to v2** — needs an OpenClaw URL scheme handler we don't control. v1 ships the bash one-liner (mobile-friendly via QR code).
- **Authentication.** v1 assumes the user is already authenticated to SkillNote in the web browser; the curl-bash setup script bakes in a short-lived token from the URL. No magic-link primitive in v1. The `Authorization: Bearer <token>` header is the only auth path on POST endpoints.
- **`/me/activity` scope.** Single user view. No team aggregation, no collective. Period default = 7d, max = 90d.
- **CLI adapter fix is in scope.** `cli/src/agents/openclaw.ts` currently writes to `PROJECT/skills/` (broken). Fix to `~/.openclaw/skills/skillnote-<slug>/` so existing `skillnote add --agent openclaw` agrees with where the meta-skill writes.
- **Claude Code keeps working unchanged.** Existing `plugin/` directory is untouched. Setup endpoint gains an `agent` parameter; the default stays `claude`.

---

## Out of Scope (explicit defers)

| Deferred | Why |
|---|---|
| `COLLECTIVE.md` / collective soul layer | Aspirational; needs team users to validate; v3 |
| `agent:bootstrap` plugin hook | The skill self-bootstraps; no plugin needed for v1 |
| Drafts / proposals queue as a primitive | Reuse content versions + comments; promote to first-class only if traction emerges |
| Drift signals as a separate table | Reuse comments with `[drift]` tag |
| Marketplace clone tracking server-side | Agent uses `clawhub` directly; reports via comment |
| Dreaming integration | High effort, no validated need |
| Magic-link auth | v1 ships with bearer token in setup script |
| `openclaw://bind/<team>` deep link | Needs OpenClaw URL scheme handler; deferred |
| Team / collective views in web UI | Solo `/me/activity` only in v1 |
| Background poller plugin (`@skillnote/openclaw-poller`) | Optional silent-sync; ship after we have users asking |

---

## 90-Day Success Metrics

- **300 ClawHub installs** of the `skillnote` skill
- **20 daily-active SkillNote+OpenClaw users**
- **Median user has ≥10 agent-authored comments and ≥30 logged invocations by week 4**
- **≥5 users return to `/me/activity` weekly in week 4**

If these miss — particularly the "5 users return weekly" one — we have a logger nobody cares about and we should reconsider the framing before building v2.

---

## Task 1: Author the `skillnote` skill body

The actual product. ~250 lines of carefully-written markdown. This is 70% of the craft and 100% of what determines whether v1 lands.

**Files:**
- Create: `backend/seed_data/skillnote.skill/SKILL.md`
- Create: `backend/seed_data/skillnote.skill/VERSION` (contents: `1.0.0`)

- [ ] **Step 1: Write the frontmatter**

```yaml
---
name: skillnote
description: |
  Connects your OpenClaw agent to SkillNote — your home for skills. Triggers on
  any skill-related activity: managing skills, leaving feedback, working with
  team registry, "what skills do I have", "which skill helps most", drafting a
  new skill, fixing a wrong skill. On first load this skill grafts itself into
  AGENTS.md so awareness persists across all future sessions.
metadata:
  openclaw:
    always: true
    emoji: "📚"
    requires:
      bins: ["clawhub"]
---
```

`always: true` keeps the skill description always-injected in the catalog so the agent loads the body on first use even without the user prompting. `requires.bins: ["clawhub"]` gates the skill from running if ClawHub is missing.

- [ ] **Step 2: Write the Bootstrap section**

Use the section already drafted in conversation (idempotent, marker-based, silent after first run, self-healing, graceful uninstall). Verbatim — see chat transcript or paste from prior agreed text. Key beats:

1. Read `~/.openclaw/skills/skillnote/config.json` for host (default: `https://skillnote.app`)
2. Read `~/.openclaw/workspace/AGENTS.md`; check for `<skillnote v1>` marker
3. If absent, append the SkillNote awareness block (template with `{{HOST}}` substituted)
4. Verify; retry once on failure; report success exactly once on first run, silence thereafter
5. Self-healing: re-graft if marker disappears
6. Uninstall (Step U): clean removal of the block

- [ ] **Step 3: Write the Operations section**

The deep manual the agent consults when it needs precision. Sections:

**3.1 — When to log an invocation.** After every skill use. `POST {{HOST}}/v1/skills/<slug>/invocations` with `{slug, agent_id, user_id, context_summary, outcome_signal}`. Fire-and-forget; ignore failures. `outcome_signal` is one of `helpful`, `mixed`, `unhelpful`, `unknown` — pick `unknown` if you genuinely cannot tell.

**3.2 — When to leave a comment.** Default: silence. Comment only when one of:
- The skill's instructions were noticeably wrong about something concrete (drift)
- The skill's example didn't match the current state of the codebase or external system
- The user explicitly said the skill helped or didn't help in a way worth recording
- You had to substantially work around the skill to complete the task

Do NOT comment to say "this helped" with no detail. Do NOT comment more than once per skill per week unless it's drift. Use `POST {{HOST}}/v1/skills/<slug>/comments` with `{author, body, author_type: "agent"}`. Author = your agent identity (e.g., `openclaw:molty`).

**3.3 — How to mark drift.** Comment body opens with `[drift]` followed by what's wrong and what evidence you have. Example: `[drift] OAuth callback example uses /v1/auth/callback but the live API returns 410 — current endpoint is /v2/auth/callback (verified at https://api.acme.com/docs).`

**3.4 — How to recognize feedback in user utterances.** Light heuristics:
- Positive: "perfect", "nailed it", "exactly", "great", "that worked"
- Negative: "wrong", "no, that's not", "off", "doesn't work", "ugh"
- Corrective: "actually it should be X", "no the real answer is Y"
On positive/corrective signals after a recent skill use, log the invocation outcome accordingly. On corrective signals, optionally leave a comment if the correction is concrete and skill-attributable.

**3.5 — How to look up "my top skills" / "my activity".** `GET {{HOST}}/v1/me/activity?period=7d`. Returns `{invocations: N, top_skills: [{slug, name, count, agent_outcome_summary}], agent_comments: [...], window_start, window_end}`. Render naturally; don't dump JSON at the user.

**3.6 — How to clone from ClawHub when you spot a gap.** Use `clawhub search <query>` and `clawhub install <slug>`. After install, leave a comment on the SkillNote-side mirror entry (if any) noting that you installed it and why. SkillNote does not have a `marketplace/clone` endpoint — the agent's act of installing IS the action; the comment is the record.

**3.7 — How to draft a new skill.** Use `POST {{HOST}}/v1/skills` (existing endpoint) with `{name, description, content_md, collections, author_type: "agent"}`. The skill enters as a draft (current behavior on the existing endpoint preserves un-published content). Comment on it with rationale — why you drafted it, what gap it fills.

**3.8 — Offline / API-unreachable handling.** If `{{HOST}}` is unreachable, every SkillNote operation fails silently. Continue serving the user. Do not retry in tight loops. Do not narrate the outage unless the user asks why something is missing — then say it once.

**3.9 — Privacy.** `context_summary` should be a short, non-sensitive descriptor of why this skill was used (e.g., "fixing prod deploy regression", not the full prompt or any code). Never log secrets, tokens, customer PII, or credentials in `context_summary` or comment bodies.

- [ ] **Step 4: Write the Self-update section**

Once a week (track via local file `~/.openclaw/skills/skillnote/.last-update-check`), `GET {{HOST}}/v1/openclaw-skill` and compare returned version to local VERSION file. If newer, `clawhub install skillnote@latest` (or fall back to writing the new content directly to the skill folder). Notify the user: *"SkillNote integration updated to v{N} — changelog: ..."*

- [ ] **Step 5: Write the Uninstall section**

When the user says *"remove skillnote"* / *"uninstall skillnote"*: run Step U (delete the AGENTS.md block), run `clawhub uninstall skillnote`, delete `~/.openclaw/skills/skillnote/`, report once.

- [ ] **Step 6: Verification**

Run by hand (in a scratch OpenClaw workspace if available, otherwise paper-trace):
1. AGENTS.md initially without marker → after first load, marker present, block matches template with host substituted
2. AGENTS.md with marker → second load is a silent no-op
3. AGENTS.md wiped between sessions → next load re-grafts, no user message
4. Uninstall path → marker block removed, surrounding content untouched

- [ ] **Step 7: Commit**

```bash
git add backend/seed_data/skillnote.skill/
git commit -m "feat: add skillnote meta-skill for OpenClaw integration

The actual product: a self-bootstrapping skill that grafts SkillNote
awareness into AGENTS.md on first load. ~250 lines of markdown that
turns OpenClaw into a SkillNote-resident agent."
```

---

## Task 2: Migration 0015 — `comments.author_type`

**Files:**
- Create: `backend/alembic/versions/0015_comments_author_type.py`

- [ ] **Step 1: Write the migration**

```python
"""add author_type to comments

Revision ID: 0015_comments_author_type
Revises: 0014_subpath_not_null
Create Date: 2026-04-26
"""
from alembic import op
import sqlalchemy as sa

revision = '0015_comments_author_type'
down_revision = '0014_subpath_not_null'
branch_labels = None
depends_on = None

AUTHOR_TYPE_VALUES = ('human', 'agent')


def upgrade() -> None:
    author_type = sa.Enum(*AUTHOR_TYPE_VALUES, name='comment_author_type')
    author_type.create(op.get_bind(), checkfirst=True)
    op.add_column(
        'comments',
        sa.Column(
            'author_type',
            author_type,
            nullable=False,
            server_default='human',
        ),
    )
    op.create_index('ix_comments_author_type', 'comments', ['author_type'])


def downgrade() -> None:
    op.drop_index('ix_comments_author_type', table_name='comments')
    op.drop_column('comments', 'author_type')
    sa.Enum(name='comment_author_type').drop(op.get_bind(), checkfirst=True)
```

- [ ] **Step 2: Apply the migration**

```bash
cd backend && alembic upgrade head
```

Expected: `INFO [alembic.runtime.migration] Running upgrade 0014_subpath_not_null -> 0015_comments_author_type`

- [ ] **Step 3: Verify the column exists**

```bash
cd backend && python -c "from app.db.session import get_db; from sqlalchemy import text; db = next(get_db()); print(db.execute(text(\"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='comments' AND column_name='author_type'\")).fetchone())"
```

Expected: `('author_type', 'USER-DEFINED')`

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/0015_comments_author_type.py
git commit -m "feat(backend): add comments.author_type enum (0015)"
```

---

## Task 3: Migration 0016 — `skill_invocations` table

**Files:**
- Create: `backend/alembic/versions/0016_skill_invocations.py`

- [ ] **Step 1: Write the migration**

```python
"""create skill_invocations table

Revision ID: 0016_skill_invocations
Revises: 0015_comments_author_type
Create Date: 2026-04-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0016_skill_invocations'
down_revision = '0015_comments_author_type'
branch_labels = None
depends_on = None

OUTCOME_VALUES = ('helpful', 'mixed', 'unhelpful', 'unknown')


def upgrade() -> None:
    outcome = sa.Enum(*OUTCOME_VALUES, name='invocation_outcome')
    outcome.create(op.get_bind(), checkfirst=True)
    op.create_table(
        'skill_invocations',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('skill_id', UUID(as_uuid=True), sa.ForeignKey('skills.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('skill_slug', sa.Text(), nullable=False, index=True),
        sa.Column('agent_id', sa.Text(), nullable=False, index=True),
        sa.Column('user_id', sa.Text(), nullable=True, index=True),
        sa.Column('context_summary', sa.Text(), nullable=True),
        sa.Column('outcome_signal', outcome, nullable=False, server_default='unknown'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, index=True),
    )
    op.create_index('ix_skill_invocations_user_created', 'skill_invocations', ['user_id', 'created_at'])
    op.create_index('ix_skill_invocations_slug_created', 'skill_invocations', ['skill_slug', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_skill_invocations_slug_created', table_name='skill_invocations')
    op.drop_index('ix_skill_invocations_user_created', table_name='skill_invocations')
    op.drop_table('skill_invocations')
    sa.Enum(name='invocation_outcome').drop(op.get_bind(), checkfirst=True)
```

- [ ] **Step 2: Apply and verify**

```bash
cd backend && alembic upgrade head
cd backend && python -c "from app.db.session import get_db; from sqlalchemy import text; db = next(get_db()); print(db.execute(text(\"SELECT to_regclass('skill_invocations')\")).scalar())"
```

Expected: `skill_invocations`

- [ ] **Step 3: Commit**

```bash
git add backend/alembic/versions/0016_skill_invocations.py
git commit -m "feat(backend): add skill_invocations table (0016)"
```

---

## Task 4: SQLAlchemy models

**Files:**
- Create: `backend/app/db/models/skill_invocation.py`
- Modify: `backend/app/db/models/comment.py`
- Modify: `backend/app/db/models/__init__.py`

- [ ] **Step 1: Write the SkillInvocation model**

Path: `backend/app/db/models/skill_invocation.py`

```python
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

OUTCOME_VALUES = ("helpful", "mixed", "unhelpful", "unknown")


class SkillInvocation(Base):
    __tablename__ = "skill_invocations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    skill_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("skills.id", ondelete="CASCADE"), nullable=False, index=True)
    skill_slug: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    user_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    context_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    outcome_signal: Mapped[str] = mapped_column(
        Enum(*OUTCOME_VALUES, name="invocation_outcome"),
        nullable=False,
        server_default="unknown",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    skill: Mapped["Skill"] = relationship("Skill")
```

- [ ] **Step 2: Add `author_type` to Comment model**

Modify `backend/app/db/models/comment.py` to add the column after `body`:

```python
from sqlalchemy import Enum
# ... existing imports ...

AUTHOR_TYPE_VALUES = ("human", "agent")


class Comment(Base):
    __tablename__ = "comments"
    # ... existing columns ...
    author_type: Mapped[str] = mapped_column(
        Enum(*AUTHOR_TYPE_VALUES, name="comment_author_type"),
        nullable=False,
        server_default="human",
        index=True,
    )
    # ... rest of class ...
```

- [ ] **Step 3: Register SkillInvocation in `__init__.py`**

Modify `backend/app/db/models/__init__.py` to import and re-export `SkillInvocation`. Append `"SkillInvocation"` to `__all__`.

- [ ] **Step 4: Verify imports**

```bash
cd backend && python -c "from app.db.models import SkillInvocation, Comment; print(SkillInvocation.__tablename__, hasattr(Comment, 'author_type'))"
```

Expected: `skill_invocations True`

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/models/
git commit -m "feat(backend): add SkillInvocation model + Comment.author_type"
```

---

## Task 5: Pydantic schemas

**Files:**
- Create: `backend/app/schemas/skill_invocation.py`
- Create: `backend/app/schemas/activity.py`
- Modify: `backend/app/schemas/comment.py`

- [ ] **Step 1: SkillInvocation schemas**

Path: `backend/app/schemas/skill_invocation.py`

```python
from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class SkillInvocationCreate(BaseModel):
    agent_id: str = Field(..., min_length=1, max_length=128)
    user_id: str | None = Field(None, max_length=128)
    context_summary: str | None = Field(None, max_length=2048)
    outcome_signal: Literal["helpful", "mixed", "unhelpful", "unknown"] = "unknown"


class SkillInvocationOut(BaseModel):
    id: UUID
    skill_slug: str
    agent_id: str
    user_id: str | None
    context_summary: str | None
    outcome_signal: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 2: Activity schemas**

Path: `backend/app/schemas/activity.py`

```python
from datetime import datetime
from pydantic import BaseModel


class TopSkill(BaseModel):
    slug: str
    name: str
    count: int
    helpful: int
    mixed: int
    unhelpful: int
    unknown: int


class AgentCommentSummary(BaseModel):
    skill_slug: str
    skill_name: str
    body: str
    created_at: datetime


class ActivityResponse(BaseModel):
    window_start: datetime
    window_end: datetime
    invocations: int
    top_skills: list[TopSkill]
    agent_comments: list[AgentCommentSummary]
```

- [ ] **Step 3: Update CommentOut to surface `author_type`**

Modify `backend/app/schemas/comment.py` to add `author_type: Literal["human", "agent"] = "human"` to both `CommentCreate` (optional, default human) and `CommentOut`.

- [ ] **Step 4: Verify imports**

```bash
cd backend && python -c "from app.schemas.skill_invocation import SkillInvocationCreate; from app.schemas.activity import ActivityResponse; from app.schemas.comment import CommentOut; print('ok')"
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/
git commit -m "feat(backend): add SkillInvocation + Activity schemas, extend Comment"
```

---

## Task 6: `POST /v1/skills/<slug>/invocations`

**Files:**
- Create: `backend/app/api/invocations.py`
- Modify: `backend/app/main.py` (mount router)
- Create: `backend/tests/integration/test_invocations_api.py`

- [ ] **Step 1: Write the endpoint**

Path: `backend/app/api/invocations.py`

```python
import uuid as uuid_lib
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.models import Skill, SkillInvocation
from app.db.session import get_db
from app.schemas.skill_invocation import SkillInvocationCreate

router = APIRouter(prefix="/v1/skills/{skill_slug}/invocations", tags=["invocations"])


@router.post("", status_code=status.HTTP_202_ACCEPTED)
def log_invocation(
    skill_slug: str,
    payload: SkillInvocationCreate,
    db: Session = Depends(get_db),
):
    skill = db.query(Skill).filter(Skill.slug == skill_slug).first()
    if not skill:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")
    inv = SkillInvocation(
        id=uuid_lib.uuid4(),
        skill_id=skill.id,
        skill_slug=skill.slug,
        agent_id=payload.agent_id,
        user_id=payload.user_id,
        context_summary=payload.context_summary,
        outcome_signal=payload.outcome_signal,
    )
    db.add(inv)
    db.commit()
    return {"ok": True}
```

- [ ] **Step 2: Mount in main.py**

Add `from app.api import invocations` and `app.include_router(invocations.router)`.

- [ ] **Step 3: Write integration tests**

Tests should cover: successful POST returns 202; missing skill returns 404; invalid `outcome_signal` returns 422; row appears in DB.

- [ ] **Step 4: Run tests**

```bash
cd backend && pytest tests/integration/test_invocations_api.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/invocations.py backend/app/main.py backend/tests/integration/test_invocations_api.py
git commit -m "feat(api): POST /v1/skills/<slug>/invocations (fire-and-forget logger)"
```

---

## Task 7: `GET /v1/me/activity`

**Files:**
- Create: `backend/app/api/me.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/integration/test_me_activity_api.py`

- [ ] **Step 1: Write the endpoint**

Path: `backend/app/api/me.py`

```python
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Comment, Skill, SkillInvocation
from app.db.session import get_db
from app.schemas.activity import ActivityResponse, AgentCommentSummary, TopSkill

router = APIRouter(prefix="/v1/me", tags=["me"])


@router.get("/activity", response_model=ActivityResponse)
def get_activity(
    user_id: str = Query(..., min_length=1),
    period: str = Query("7d", pattern=r"^(7d|14d|30d|90d)$"),
    db: Session = Depends(get_db),
):
    days = int(period.rstrip("d"))
    window_end = datetime.now(timezone.utc)
    window_start = window_end - timedelta(days=days)

    base_q = db.query(SkillInvocation).filter(
        SkillInvocation.user_id == user_id,
        SkillInvocation.created_at >= window_start,
    )
    invocations = base_q.count()

    # Top skills with outcome breakdown
    rows = db.query(
        SkillInvocation.skill_slug,
        Skill.name,
        func.count(SkillInvocation.id).label("count"),
        func.sum(func.case((SkillInvocation.outcome_signal == "helpful", 1), else_=0)).label("helpful"),
        func.sum(func.case((SkillInvocation.outcome_signal == "mixed", 1), else_=0)).label("mixed"),
        func.sum(func.case((SkillInvocation.outcome_signal == "unhelpful", 1), else_=0)).label("unhelpful"),
        func.sum(func.case((SkillInvocation.outcome_signal == "unknown", 1), else_=0)).label("unknown"),
    ).join(Skill, Skill.id == SkillInvocation.skill_id).filter(
        SkillInvocation.user_id == user_id,
        SkillInvocation.created_at >= window_start,
    ).group_by(SkillInvocation.skill_slug, Skill.name).order_by(func.count(SkillInvocation.id).desc()).limit(10).all()

    top_skills = [TopSkill(slug=r.skill_slug, name=r.name, count=r.count, helpful=r.helpful or 0, mixed=r.mixed or 0, unhelpful=r.unhelpful or 0, unknown=r.unknown or 0) for r in rows]

    # Agent comments by this user's agent (we identify by agent_id in invocations matching this user)
    agent_ids = [r[0] for r in db.query(SkillInvocation.agent_id).filter(SkillInvocation.user_id == user_id).distinct().all()]
    comments = db.query(Comment, Skill).join(Skill, Skill.id == Comment.skill_id).filter(
        Comment.author_type == "agent",
        Comment.author.in_(agent_ids) if agent_ids else False,
        Comment.created_at >= window_start,
    ).order_by(Comment.created_at.desc()).limit(50).all()

    agent_comments = [
        AgentCommentSummary(
            skill_slug=skill.slug,
            skill_name=skill.name,
            body=comment.body,
            created_at=comment.created_at,
        )
        for comment, skill in comments
    ]

    return ActivityResponse(
        window_start=window_start,
        window_end=window_end,
        invocations=invocations,
        top_skills=top_skills,
        agent_comments=agent_comments,
    )
```

- [ ] **Step 2: Mount router**

Add to `main.py`: `from app.api import me; app.include_router(me.router)`

- [ ] **Step 3: Write integration tests**

Cover: empty activity returns zeros; invocations + comments aggregate correctly; period parameter respected; invalid period → 422.

- [ ] **Step 4: Run tests**

```bash
cd backend && pytest tests/integration/test_me_activity_api.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/me.py backend/app/main.py backend/tests/integration/test_me_activity_api.py
git commit -m "feat(api): GET /v1/me/activity (top skills + agent comments)"
```

---

## Task 8: `GET /v1/openclaw-skill`

Serves the meta-skill content from `backend/seed_data/skillnote.skill/SKILL.md` so we can ship updates by republishing one file. The skill itself self-checks this endpoint weekly.

**Files:**
- Create: `backend/app/api/openclaw.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/integration/test_openclaw_skill_api.py`

- [ ] **Step 1: Write the endpoint**

Path: `backend/app/api/openclaw.py`

```python
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel

from app.core.errors import api_error

router = APIRouter(prefix="/v1/openclaw-skill", tags=["openclaw"])

SEED_DIR = Path(__file__).resolve().parents[2] / "seed_data" / "skillnote.skill"
SKILL_FILE = SEED_DIR / "SKILL.md"
VERSION_FILE = SEED_DIR / "VERSION"


class OpenClawSkillResponse(BaseModel):
    version: str
    content: str


@router.get("", response_model=OpenClawSkillResponse)
def get_openclaw_skill():
    if not SKILL_FILE.exists() or not VERSION_FILE.exists():
        raise api_error(500, "SEED_MISSING", "OpenClaw skill seed not found")
    return OpenClawSkillResponse(
        version=VERSION_FILE.read_text().strip(),
        content=SKILL_FILE.read_text(),
    )
```

- [ ] **Step 2: Mount router**

Add to `main.py`: `from app.api import openclaw; app.include_router(openclaw.router)`

- [ ] **Step 3: Tests + run**

```bash
cd backend && pytest tests/integration/test_openclaw_skill_api.py -v
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/openclaw.py backend/app/main.py backend/tests/integration/test_openclaw_skill_api.py
git commit -m "feat(api): GET /v1/openclaw-skill (serves the meta-skill)"
```

---

## Task 9: Frontend API client

**Files:**
- Create: `src/lib/api/activity.ts`
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add Activity types**

Add to `src/lib/types.ts`:

```typescript
export type AuthorType = "human" | "agent"
export type InvocationOutcome = "helpful" | "mixed" | "unhelpful" | "unknown"

export interface TopSkill {
  slug: string
  name: string
  count: number
  helpful: number
  mixed: number
  unhelpful: number
  unknown: number
}

export interface AgentCommentSummary {
  skill_slug: string
  skill_name: string
  body: string
  created_at: string
}

export interface ActivityResponse {
  window_start: string
  window_end: string
  invocations: number
  top_skills: TopSkill[]
  agent_comments: AgentCommentSummary[]
}
```

Also update the existing `Comment` type to include `author_type: AuthorType`.

- [ ] **Step 2: Write the client**

Path: `src/lib/api/activity.ts`

```typescript
import { apiRequest } from './client'
import type { ActivityResponse } from '@/lib/types'

export function fetchMyActivity(userId: string, period: '7d' | '14d' | '30d' | '90d' = '7d'): Promise<ActivityResponse> {
  return apiRequest<ActivityResponse>(`/v1/me/activity?user_id=${encodeURIComponent(userId)}&period=${period}`)
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/activity.ts src/lib/types.ts
git commit -m "feat(web): activity API client + types"
```

---

## Task 10: Web UI — `/me/activity`

**Files:**
- Create: `src/app/(app)/me/activity/page.tsx`
- Create: `src/components/me/ActivityFeed.tsx`
- Create: `src/components/me/TopSkillsCard.tsx`
- Create: `src/components/me/AgentCommentsCard.tsx`

- [ ] **Step 1: Page shell**

Path: `src/app/(app)/me/activity/page.tsx`

Render header "What your agent has been doing" + period selector (7d/14d/30d/90d) + three cards: SummaryStrip, TopSkillsCard, AgentCommentsCard. Use the existing `(app)` layout (sidebar + topbar).

- [ ] **Step 2: SummaryStrip**

A simple horizontal strip with: total invocations in window, helpful %, distinct skills used. One-line, compact.

- [ ] **Step 3: TopSkillsCard**

A list of top 10 skills with: name (linked to `/skills/<slug>`), invocation count, mini outcome bar (helpful / mixed / unhelpful / unknown segments).

- [ ] **Step 4: AgentCommentsCard**

Group agent comments by skill, show last comment per skill with timestamp. "[drift]" comments get a yellow highlight badge. Click → opens skill detail with comments tab.

- [ ] **Step 5: Empty states**

If 0 invocations: render onboarding card *"Your OpenClaw agent hasn't logged any skill activity yet. Install the SkillNote skill via `clawhub install skillnote` and the next session will start logging."* Include link to Settings → Connect via OpenClaw.

- [ ] **Step 6: Update SkillCommentsTab to badge agent comments**

Modify `src/components/skills/SkillCommentsTab.tsx` to render a small *"agent"* badge next to comments where `author_type === 'agent'`. Drift comments (`body.startsWith("[drift]")`) get a yellow badge.

- [ ] **Step 7: E2E test**

Add `e2e/tests/me-activity.spec.ts` with mocked API responses; assert page renders top skills, agent comments group, empty state.

- [ ] **Step 8: Commit**

```bash
git add src/app/(app)/me/activity/ src/components/me/ src/components/skills/SkillCommentsTab.tsx e2e/tests/me-activity.spec.ts
git commit -m "feat(web): /me/activity page + agent-comment badges"
```

---

## Task 11: Web UI — Settings "Connect via OpenClaw" card

**Files:**
- Create: `src/components/settings/ConnectOpenClawCard.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

- [ ] **Step 1: Build the card**

Three tabs/sections in one card:

1. **One-line install** — `clawhub install skillnote` (copy button). Subtitle: "Connects to the SkillNote free tier."
2. **Self-hosted install** — bash one-liner `curl -fsSL <host>/v1/setup?agent=openclaw&token=<short-lived> | bash` (copy button + QR code rendered with a library like `qrcode.react`). Subtitle: "Bakes in your team's host. Token expires in 10 minutes."
3. **What happens** — three-line explanation: *(1) installs the skillnote skill in OpenClaw, (2) writes config.json with your host, (3) on next session your agent grafts itself into AGENTS.md*.

The token is generated client-side by calling a new endpoint `POST /v1/setup/openclaw-token` (covered in Task 12) which returns a short-lived bearer.

- [ ] **Step 2: Mount on Settings page**

Add to `src/app/(app)/settings/page.tsx` next to existing About / Profile / Integrations cards.

- [ ] **Step 3: E2E test**

Verify the card renders, copy buttons work, QR appears for the self-hosted variant.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/ConnectOpenClawCard.tsx src/app/(app)/settings/page.tsx
git commit -m "feat(web): Settings 'Connect via OpenClaw' card"
```

---

## Task 12: Backend — extend `/v1/setup` for OpenClaw

**Files:**
- Modify: `backend/app/api/setup.py`
- Create: `backend/tests/integration/test_setup_openclaw.py`

- [ ] **Step 1: Add `agent` query param**

Modify the `/v1/setup` endpoint to accept `agent: str = "claude"`. If `agent == "openclaw"`, return a different bash script.

- [ ] **Step 2: Write the OpenClaw setup script**

The script:
1. Validates `clawhub` is installed (`command -v clawhub`)
2. Creates `~/.openclaw/skills/skillnote/` directory
3. Writes `config.json` with `{host, team, boundAt, token}` from setup query params
4. Runs `clawhub install skillnote`
5. Prints "✓ SkillNote bound to {host}. Open OpenClaw and the agent will graft itself on next session."

Reuse the symlink-safe extraction guard pattern from the existing `/v1/plugin.zip` route.

- [ ] **Step 3: Add `POST /v1/setup/openclaw-token`**

Returns `{token: <short-lived>, expires_at}`. v1 implementation: signed JWT with 10-minute TTL containing `{user_id, host}`. Reuse any existing JWT signing in the codebase or add a minimal HMAC-based token (5 lines of code).

- [ ] **Step 4: Tests**

```bash
cd backend && pytest tests/integration/test_setup_openclaw.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/setup.py backend/tests/integration/test_setup_openclaw.py
git commit -m "feat(api): /v1/setup?agent=openclaw + /v1/setup/openclaw-token"
```

---

## Task 13: Fix the broken CLI adapter

**Files:**
- Modify: `cli/src/agents/openclaw.ts`
- Modify: `cli/src/__tests__/agents/openclaw.test.ts` (create or update)

- [ ] **Step 1: Fix the path**

Replace `path.join(this.projectDir, 'skills', slug)` with `path.join(this.homeDir, '.openclaw', 'skills', \`skillnote-${slug}\`)`.

- [ ] **Step 2: Add a vitest test**

Verify `skillDir('foo-bar')` returns `~/.openclaw/skills/skillnote-foo-bar` (absolute path).

- [ ] **Step 3: Run tests**

```bash
cd cli && npm test
```

- [ ] **Step 4: Commit**

```bash
git add cli/src/agents/openclaw.ts cli/src/__tests__/agents/openclaw.test.ts
git commit -m "fix(cli): OpenClaw adapter writes to ~/.openclaw/skills/skillnote-<slug>/

Was writing to PROJECT/skills/, which never matched what OpenClaw actually
loads. Now matches the path the meta-skill writes to."
```

---

## Task 14: Docs (README + CLAUDE.md)

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README — flip OpenClaw status**

In the Integrations section, replace "OpenClaw: Planned" with:

```markdown
### OpenClaw

`clawhub install skillnote` — that's it.

The meta-skill grafts itself into your OpenClaw `AGENTS.md` on first load.
Every session afterward your agent already knows about SkillNote and will
log skill activity, leave comments where it helps, and surface drift when
it sees skills go stale. View the activity feed at `/me/activity`.

For self-hosted deployments, use the "Connect via OpenClaw" button in
Settings to generate a one-line install for your team.
```

- [ ] **Step 2: CLAUDE.md — fix the migration count + add OpenClaw section**

Update the migrations claim (currently says 4, reality is 16 after this PR). Add a brief "OpenClaw integration" subsection under Authentication, pointing at the v1 plan and the seed skill.

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: flip OpenClaw to Supported, fix migration count"
```

---

## Task 15: Version bump + CHANGELOG

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version**

`package.json`: `"version": "0.4.0"` (was 0.3.4).

- [ ] **Step 2: Add CHANGELOG entry**

```markdown
## 0.4.0 — 2026-04-26

### Added
- **OpenClaw native integration.** `clawhub install skillnote` connects an OpenClaw agent to SkillNote via a self-bootstrapping skill that grafts itself into `AGENTS.md`.
- `POST /v1/skills/<slug>/invocations` — fire-and-forget invocation logger.
- `GET /v1/me/activity` — agent activity feed (top skills, outcome breakdown, agent comments).
- `GET /v1/openclaw-skill` — serves the meta-skill content for self-update checks.
- `comments.author_type` enum (`human` | `agent`) — agent-authored comments are now first-class.
- `skill_invocations` table — append-only usage log keyed by user + skill + timestamp.
- Web UI: `/me/activity` page showing what your agent has been doing.
- Web UI: Settings → "Connect via OpenClaw" card with one-line install + QR.
- `GET /v1/setup?agent=openclaw` — bash one-liner installer for self-hosted teams.

### Fixed
- CLI OpenClaw adapter (`cli/src/agents/openclaw.ts`) was writing skills to the project directory; now writes to `~/.openclaw/skills/skillnote-<slug>/` (the path OpenClaw actually loads).

### Migrations
- 0015: `comments.author_type` enum column
- 0016: `skill_invocations` table

### Deferred (not in this release)
- Collective soul / `COLLECTIVE.md` layer
- `agent:bootstrap` plugin hook (the skill self-bootstraps; no plugin needed)
- Drafts/proposals queue as a primitive
- `openclaw://bind/<team>` deep link (needs OpenClaw URL scheme handler)
- Magic-link auth for setup (uses bearer token in v1)
```

- [ ] **Step 3: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): 0.4.0 — OpenClaw native integration"
```

---

## Task 16: Open the PR

- [ ] **Step 1: Push**

```bash
git push -u origin feat/skillnote-openclaw-v1
```

- [ ] **Step 2: Create PR**

Title: `feat: OpenClaw native integration via self-bootstrapping skill (v0.4.0)`

Body: Summary of the architecture (one paragraph), the test plan (per-task verification), the v2 deferral list, the 90-day success metrics. Link to this plan file.

---

## Validation Order (what depends on what)

```
1 (skill body)        ── product, can be drafted in parallel with everything
2 (mig 0015)          ── prereq for 4
3 (mig 0016)          ── prereq for 4
4 (models)            ── prereq for 5, 6
5 (schemas)           ── prereq for 6, 7
6 (POST invocations)  ── prereq for 7 (well-tested data path)
7 (GET activity)      ── prereq for 9, 10
8 (GET openclaw-skill)── prereq for 11 (Connect card calls token endpoint, not this)
9 (frontend client)   ── prereq for 10
10 (/me/activity)     ── independent of 11/12
11 (Settings card)    ── prereq: 12 (token endpoint)
12 (setup endpoint)   ── independent of 10/11 server-side
13 (CLI adapter fix)  ── independent
14 (docs)             ── after everything
15 (version + CHANGELOG) ── after 14
16 (PR)               ── final
```

Tasks 2 and 3 can run in parallel. Task 1 (the skill body) is the highest-leverage and should be done first, in parallel with the migrations, because it's the deliverable that unlocks user-side validation as soon as the backend is up.

---

## GSTACK REVIEW REPORT

**Run:** 2026-04-26 — `/autoplan` with Claude voices only (Codex unavailable on this machine).
**Verdict:** **REVISE — material rework required before any code merges.** Architecture is salvageable; multiple critical bugs, security gaps, and missing UX layers must be addressed first.

### Top-Level Scores

| Run | Verdict | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| CEO (Claude voice + subagent) | REJECT | 3 | 5 | 3 | 2 |
| Engineering | REJECT | 4 | 7 | 9 | 5 |
| Design | REJECT (visual spec only — backend approve) | 4 | 7 | 4 | 5 |
| DX | REJECT | 4 | 6 | 7 | 3 |

### CEO Consensus Table

| Dimension | Claude voice | Subagent voice | Consensus |
|---|---|---|---|
| 1. Premises valid? | NO — assumed not validated | NO — TAM is rounding error | **CONFIRMED concern** |
| 2. Right problem? | QUESTIONABLE — reframings unexplored | NO — product is "View My Logs" | **CONFIRMED concern** |
| 3. Scope correct? | WRONG-SHAPED — persona mismatch | WRONG — persona schizophrenia | **CONFIRMED concern** |
| 4. Alternatives explored? | NO — only briefly dismissed | NO — three alternatives propose 10x impact | **CONFIRMED concern** |
| 5. Competitive risk addressed? | NO — no moat named | NO — ClawHub can ship in 2 sprints | **CONFIRMED concern** |
| 6. 6-month trajectory? | REGRET LIKELY | REGRET — 5 explicit scenarios | **CONFIRMED concern** |

**6/6 dimensions CONFIRMED concerns. Both CEO voices say REJECT or revise materially.**

### Engineering Consensus Table

| Dimension | Subagent voice | Status |
|---|---|---|
| 1. Architecture sound? | NO — auth contradiction, self-update RCE pattern | DISAGREE flagged |
| 2. Test coverage sufficient? | NO — 12 specific gaps documented | CONFIRMED gap |
| 3. Performance risks addressed? | NO — `/me/activity` GROUP BY scale, no caching, no rate limit | CONFIRMED |
| 4. Security threats covered? | NO — open `?user_id=` PII oracle, unauthenticated POST, unsigned RCE | CONFIRMED |
| 5. Error paths handled? | NO — fire-and-forget hides errors, no error envelope on 202 | CONFIRMED |
| 6. Deployment risk manageable? | YES — migrations safe with one tweak (concurrent index) | CONFIRMED safe |

### Design Consensus Table

Single voice (Claude design subagent) — 14/70 aggregate score. Design REJECTS visual spec, APPROVES backend architecture.

| Dimension | Score | Notes |
|---|---|---|
| Information hierarchy | 3/10 | Order unspecified; vanity stats buried agent voice |
| State coverage | 2/10 | Loading/error/offline/partial all unspec'd |
| Emotional design | 1/10 | Treated as data dashboard; no narrative arc |
| Specificity | 2/10 | Every visual decision hand-waved |
| Mobile/responsive | 3/10 | No breakpoint guidance |
| Accessibility | 1/10 | Yellow drift = colorblind fail; outcome bar color-only |
| Visual differentiation | 2/10 | Agent vs human comment is THE central new visual; got one sentence |

### DX Consensus Table

Single voice (Claude DX subagent).

| Dimension | Score | Notes |
|---|---|---|
| TTHW (target <5min) | 3/10 | Solo path is broken end-to-end (no `user_id` binding) |
| API/CLI naming | 4/10 | `/me/activity?user_id=` is a contradiction; inconsistent verbs/resources |
| Error messages | 2/10 | Not addressed at all |
| Documentation | 1/10 | 12-line README blurb is the entire ship |
| Upgrade path | 2/10 | Unsigned, unversioned, unrollback-able auto-update |
| Debugging | 1/10 | Zero diagnostic affordances; existing `doctor.ts` precedent ignored |
| Privacy/trust disclosure | 1/10 | Autonomous AGENTS.md mutation with no consent |
| Skill author guidance | 0/10 | Completely silent |

### Cross-Phase Themes — High-Confidence Signal

These concerns appeared independently in **2 or more reviewer phases**:

1. **`https://skillnote.app` is undefined infrastructure.** Flagged by CEO + DX. Domain ownership, hosting, privacy, retention all unspecified. Plan ships a default that may not exist.

2. **Auth contradiction.** CEO + Eng + DX. Plan claims bearer token; endpoints have no auth. Anyone can read any user's `/me/activity` with `?user_id=X`.

3. **Solo install is broken end-to-end.** CEO + DX. No `user_id` binding step → web UI permanently empty for solo users → entire free-tier flow is decorative.

4. **Bootstrap consent missing.** CEO + Eng + DX + Design. Skill autonomously edits `~/.openclaw/workspace/AGENTS.md` with no disclosure or "continue Y/n" gate.

5. **Self-update is unsigned RCE.** CEO + Eng + DX. Weekly auto-pull of arbitrary instructions from a backend endpoint, executed by every connected agent on next session.

6. **Persona schizophrenia.** CEO + DX. Solo path + free tier + `/me/activity` ALSO ships team-admin tokens + Settings card + JWT. Different humans, different jobs.

7. **Drift via `[drift]` string-prefix is brittle.** CEO + Eng + Design + DX. All four flagged the magic-string protocol independently.

8. **No diagnose/debug affordance.** Eng + DX. Existing `cli/src/commands/doctor.ts` (138 lines) ignored as precedent.

9. **No moat against ClawHub.** CEO. ClawHub can ship private/team registries in weeks; plan never addresses what stops them.

### Critical Engineering Bugs (mechanical fixes)

These are not strategic decisions — they are wrong code that won't compile/run:

| Bug | File | Fix |
|---|---|---|
| `func.case` doesn't exist in SQLAlchemy 2.x | Task 7 plan code | Use `from sqlalchemy import case`; call `case((cond, 1), else_=0)` (no `func.`) |
| `Comment.author.in_([]) if [] else False` mixes Python literal with SQL | Task 7 plan code | Short-circuit: `if not agent_ids: return ActivityResponse(... empty agent_comments ...)` |
| Cross-user comment leak via shared `agent_id` | Task 7 query | Add `comments.user_id` (FK) to migration 0015; filter on it directly |
| `POST /v1/skills/<slug>/invocations` synchronously commits but returns 202 | Task 6 endpoint | Either truly async (background queue) or drop the "fire-and-forget" framing |
| `GET /v1/openclaw-skill` reads disk every request | Task 8 endpoint | Module-level cache + ETag; Path computed from settings, not `__file__` arithmetic |
| Enum redefinition risk (migration + model both declare) | Task 4 model | `Enum(..., name="...", create_type=False)` in the model |
| `comments.author_type` index non-concurrent | Migration 0015 | Use `postgresql_concurrently=True` in a separate migration (CREATE INDEX CONCURRENTLY can't run inside a transaction) |
| Skill body refs `POST /v1/skills` with `author_type: agent` field that doesn't exist on `SkillCreate` schema | Task 1 §3.7 | Either add the field to schema or remove the instruction |
| Skill body calls `/v1/me/activity` without required `user_id` query param | Task 1 §3.5 | Document where agent gets `user_id` (config.json) |

### User Challenges (both reviewers agree the user's stated direction should change)

These are NEVER auto-decided. The user must explicitly choose.

**UC1 — Reframe the product.** Multiple reviewers strongly propose alternatives: (A) Datadog-for-skills observability across all agents, (B) thin curator/proxy on top of ClawHub, (C) skip OpenClaw entirely and double down on Claude Code paid teams. The current "parallel registry" framing has weak moat against ClawHub.
- **You said:** parallel registry for OpenClaw with self-bootstrapping skill
- **Both reviewers recommend:** stop, reframe, then revisit
- **What we might be missing:** founder-level intuition about OpenClaw's growth trajectory; an existing customer relationship that demands this specific framing
- **If we're wrong, the cost is:** 3 weeks building a thing ClawHub clones in a month

**UC2 — Pick one persona.** Solo dev OR team admin. Plan ships features for both, doing each badly.
- **You said:** support both via free tier + self-hosted curl-bash
- **Both reviewers recommend:** team admin (consistent with SkillNote's "private servers" positioning) or solo (simpler, narrower), but not both
- **What we might be missing:** market signal that solo-to-team is a real conversion path
- **If we're wrong, the cost is:** v1 feels half-baked to both audiences

**UC3 — Add explicit consent gate before AGENTS.md mutation.** All four reviewers flag this. Industry baseline (Homebrew, VS Code, npm postinstall) increasingly requires consent before touching dotfiles.
- **You said:** silent autonomous graft on first load (idempotent, self-healing)
- **All four reviewers recommend:** one "SkillNote will append to your AGENTS.md. Continue? [Y/n]" prompt before mutation
- **What we might be missing:** prior user testing showing silence is the right default
- **If we're wrong, the cost is:** trust footgun + possible ClawHub marketplace rejection of pattern

**UC4 — Provision `https://skillnote.app` BEFORE shipping (or remove the free-tier claim).** Plan defaults users to a hosted instance whose existence, terms, and policies aren't specified.
- **You said:** default to hosted free tier
- **CEO + DX recommend:** either provision it (domain, hosting, privacy/ToS, rate limits, retention policy) before merge — OR ship as self-host-only and remove the free-tier path
- **What we might be missing:** existing infra plans not in the plan file
- **If we're wrong, the cost is:** users install a skill that points to nothing and we eat the support hit

**UC5 — Add bind handshake to solo install path.** Without it, the agent posts invocations with no `user_id` and the web UI is permanently empty.
- **You said:** solo install is one-command (just `clawhub install skillnote`)
- **DX recommends:** add a browser-based bind step where user confirms once and the skill receives a `user_id`. Two clicks total, but end-to-end works.
- **What we might be missing:** thinking the agent identity is enough (it isn't — the web UI needs user identity)
- **If we're wrong, the cost is:** broken hello-world experience for every solo installer

**UC6 — Replace 90-day metrics with retention + at-least-one-team.** Install count is a hobby ceiling.
- **You said:** 300 installs / 20 DAU / ≥10 comments / 5 weekly returners
- **CEO recommends:** % of installs still active at day 30 (retention is the only PMF metric that matters), at least one team of 5+ devs all daily-active in week 4, qualitative interviews with 10 power users
- **What we might be missing:** bias toward measurable-quickly metrics for an early-stage validation
- **If we're wrong, the cost is:** hitting vanity numbers and learning nothing about whether to keep building

**UC7 — Status word.** Plan flips OpenClaw from "Planned" to "Supported" but the integration is materially shallower than Claude Code (one skill vs plugin + 6 hooks + sync + picker).
- **You said:** "Supported"
- **CEO recommends:** "Beta" or "Skill-only" until parity
- **What we might be missing:** marketing intent
- **If we're wrong, the cost is:** credibility tax with existing Claude Code users when they read the docs and realize OpenClaw lacks parity

### Taste Decisions (reasonable people could disagree)

**TD1 — Approve-with-major-rework vs reject-and-restart.** Architecture is salvageable; bugs are fixable. Recommend: APPROVE WITH MAJOR REWORK (Option D in the gate). Reject would mean throwing away the plan structure; the plan structure is good — its premises and details need work.

**TD2 — QR code on Settings card.** Design says drop (performative); product might want it for demo polish. Recommend: drop in v1, add later if real signal.

**TD3 — `comments` table reuse vs `comments.tag` enum column.** Plan reuses `comments` for drift via `[drift]` string prefix. Eng + DX + Design all flag this. Recommend: add `comments.tag` (text-array or enum) NOW — one extra column in migration 0015, unblocks v2 queries with no v1 surface change.

**TD4 — `metadata.openclaw.always: true` vs lazy load.** Plan keeps the 250-line skill body always-loaded (eats ~30% of skill prompt budget). My CEO review recommends lazy load with tight description. Recommend: lazy load — bootstrap runs on first trigger, AGENTS.md fragment carries always-on awareness, body only loads when needed.

### Recommended v1.1 Plan Adjustments (if user picks Option D)

If the user wants to revise rather than reject, the minimum revision pass is:

1. **Add Task 0 — Infrastructure & Customer Discovery.** 10 OpenClaw-user interviews; named-target install list; `https://skillnote.app` provisioned with privacy/ToS or removed; decide on persona (solo or team).
2. **Add Task 0.5 — Auth.** Bearer token enforcement on every POST/GET; `comments.user_id` added to migration 0015; bind handshake spec for solo path.
3. **Fix all critical engineering bugs in-line in the plan.** SQL bugs, query bugs, RCE pattern. ~30 min of plan edits.
4. **Replace Task 1 §1 (Bootstrap) with consent gate version.** "Continue Y/n" prompt; signed self-update; defined uninstall contract.
5. **Replace Task 10/11 (frontend) with locked visual spec.** Page ordering (AgentComments first), outcome bar shape, drift token, settings section pattern (no card chrome), all states inventoried, QR dropped.
6. **Add Task 0.7 — Diagnose script.** ~40-line `~/.openclaw/skills/skillnote/diagnose.sh`.
7. **Replace 90-day metrics.** Retention + team-of-5 + qualitative interviews.
8. **Add `comments.tag` array column to migration 0015.** Promotes drift to first-class queryable.
9. **Either pick persona OR cut team install entirely from v1.** Reduces surface ~20%.
10. **Status word: "Beta," not "Supported."**

After these adjustments, plan is shippable in 2-3 weeks. Without them, plan ships broken and gets a viral bad-bug-report in week 1.

### Final Gate

This review surfaces **6 critical findings** (cross-phase consensus), **9 critical engineering bugs** (mechanical), and **7 user challenges** (require user judgment). The plan structure is sound; the plan content needs material rework before any code merges.

**Recommended action: Option D (REVISE) — apply the v1.1 adjustments above, then re-run focused review on changed sections.**


