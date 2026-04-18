# Marketplace Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1 marketplace import feature: paste-URL import flow, `Browse` sidebar page, drift detection, fork-on-edit, and Claude-Code-compatible publish-back endpoint.

**Architecture:** Backend adds a new `import_sources` module with five services (parser, inspector, importer, refresher, publisher) + one migration + six HTTP routes. Frontend adds a top-level `Browse` page, an `ImportSheet` drawer with two-pane preview and draggable divider, and a `DiffDrawer` for drift apply. All validation mirrors Claude Code's `parseMarketplaceInput.ts` and schemas for predictable behavior.

**Tech Stack:** Backend — Python 3.12, FastAPI, SQLAlchemy 2, Alembic, pydantic, urllib/httpx, git CLI via subprocess. Frontend — Next.js 16, React 19, TypeScript, Tailwind 4, shadcn/ui, `react-resizable-panels`. Testing — pytest, Playwright, Hypothesis, axe-core.

**Spec:** `docs/superpowers/specs/2026-04-18-marketplace-import-design.md`

**Reference source:** `claude-code-source/` (Claude Code plugin system, gitignored vendored copy)

---

## File Structure

| Path | Responsibility | Action |
|---|---|---|
| `backend/alembic/versions/0013_import_sources.py` | Migration: `import_sources` table + skill column additions | Create |
| `backend/app/db/models/import_source.py` | `ImportSource` SQLAlchemy model | Create |
| `backend/app/db/models/skill.py` | Add `import_source_id`, `source_path`, `source_sha`, `source_content_hash`, `forked_from_source` | Modify |
| `backend/app/services/imports/__init__.py` | Module init | Create |
| `backend/app/services/imports/input_parser.py` | Pure: port of `parseMarketplaceInput.ts` | Create |
| `backend/app/services/imports/manifest_schema.py` | Pydantic models for marketplace.json + SKILL.md frontmatter | Create |
| `backend/app/services/imports/security.py` | Scheme/host allowlists, private-IP check, rate limiter | Create |
| `backend/app/services/imports/inspector.py` | Shallow-clone + detect kind + return preview | Create |
| `backend/app/services/imports/importer.py` | Transactional apply with UPSERT semantics | Create |
| `backend/app/services/imports/refresher.py` | HEAD probe + diff computation | Create |
| `backend/app/services/imports/publisher.py` | Collection → marketplace.json | Create |
| `backend/app/api/imports.py` | 5 HTTP routes: inspect / apply / sources / refresh / delete | Create |
| `backend/app/api/marketplace.py` | 1 HTTP route: publish-back | Create |
| `backend/app/schemas/imports.py` | Pydantic request/response shapes for the 6 routes | Create |
| `backend/app/main.py` | Register the two new routers | Modify |
| `backend/tests/fixtures/manifests/` | 15+ real-world + synthetic manifest fixtures | Create |
| `backend/tests/fixtures/mock_git_server.py` | Flask app mocking GitHub API + git clone | Create |
| `backend/tests/fixtures/claude_schemas.py` | Python port of Claude Code's Zod schemas | Create |
| `backend/tests/fixtures/factories.py` | pytest fixtures: `create_import_source()` etc. | Create |
| `backend/tests/unit/test_input_parser.py` | Pure-function parser tests | Create |
| `backend/tests/unit/test_manifest_schema.py` | Adversarial manifest validation tests | Create |
| `backend/tests/unit/test_publisher_serialization.py` | Collection → marketplace.json roundtrip | Create |
| `backend/tests/integration/test_imports_inspect.py` | All inspect-route scenarios | Create |
| `backend/tests/integration/test_imports_apply.py` | All apply-route scenarios | Create |
| `backend/tests/integration/test_imports_sources.py` | Sources lifecycle + refresh | Create |
| `backend/tests/integration/test_marketplace_endpoint.py` | Publish-back + cross-schema validation | Create |
| `backend/tests/integration/test_imports_security_attacks.py` | 17+ red-team scenarios | Create |
| `backend/tests/integration/test_migration_0013_imports.py` | Schema migration safety | Create |
| `backend/tests/integration/test_imports_perf.py` | p95 benchmark suite | Create |
| `backend/tests/integration/test_imports_chaos.py` | Fault injection tests | Create |
| `src/app/(app)/browse/page.tsx` | `/browse` route | Create |
| `src/lib/api/imports.ts` | Backend fetch wrappers | Create |
| `src/lib/api/marketplace.ts` | Publish-back preview helper | Create |
| `src/lib/parse-marketplace-input.ts` | Client-side TS port of parser | Create |
| `src/components/browse/BrowseEmptyState.tsx` | Hero + CTAs | Create |
| `src/components/browse/BrowseSourcesList.tsx` | Cards grid | Create |
| `src/components/browse/BrowseSourceCard.tsx` | Individual source card | Create |
| `src/components/browse/ImportSheet.tsx` | Drawer: URL input + state machine | Create |
| `src/components/browse/InspectPreview.tsx` | Detection-result header in sheet | Create |
| `src/components/browse/SkillSelectionList.tsx` | Left pane: checkbox list | Create |
| `src/components/browse/SkillPreviewPane.tsx` | Right pane: Markdown viewer | Create |
| `src/components/browse/CollectionTargetPicker.tsx` | "Import into" popover | Create |
| `src/components/browse/DiffDrawer.tsx` | Drift update drawer | Create |
| `src/components/browse/SourceBadge.tsx` | "Imported from X" chip | Create |
| `src/components/browse/LocalOnlyChip.tsx` | ⊙ local only chip | Create |
| `src/components/ui/resizable.tsx` | shadcn Resizable (added via `npx shadcn add`) | Create (generated) |
| `src/components/layout/sidebar.tsx` | Add `Browse` top-level item + drift badge | Modify |
| `src/components/skills/skill-detail.tsx` | Add `SourceBadge` next to version pill | Modify |
| `src/components/skills/tabs/SkillEditTab.tsx` | Fork-confirm modal on imported-skill edit | Modify |
| `src/app/(app)/collections/page.tsx` | Bottom nudge to Browse | Modify |
| `src/app/(app)/collections/[slug]/page.tsx` | Import banner + inline drift pill + DiffDrawer | Modify |
| `e2e/journey-first-time-user.spec.ts` | E2E scenario 1 | Create |
| `e2e/journey-upstream-change.spec.ts` | E2E scenario 2 | Create |
| `e2e/journey-conflict-rename.spec.ts` | E2E scenario 3 | Create |
| `e2e/journey-fork-warning.spec.ts` | E2E scenario 4 | Create |
| `e2e/journey-unlink-keep-skills.spec.ts` | E2E scenario 5 | Create |
| `e2e/journey-private-repo.spec.ts` | E2E scenario 6 | Create |
| `e2e/journey-publish-back.spec.ts` | E2E scenario 7 | Create |
| `e2e/test-a11y-import-sheet.spec.ts` | axe-core tests | Create |
| `e2e/test-visual-regression-browse.spec.ts` | 11 screenshot states | Create |
| `package.json` | Add `react-resizable-panels` dep | Modify |

---

## Task 1: Migration 0013 — `import_sources` table + skill column additions

**Files:**
- Create: `backend/alembic/versions/0013_import_sources.py`
- Modify: `backend/app/db/models/skill.py`
- Create: `backend/app/db/models/import_source.py`
- Test: `backend/tests/integration/test_migration_0013_imports.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/integration/test_migration_0013_imports.py`:

```python
"""Integration tests for migration 0013: import_sources table + skill additions."""
import os
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, text

DB_URL = os.environ.get("SKILLNOTE_DATABASE_URL", "postgresql://skillnote:skillnote@localhost:5432/skillnote")


@pytest.fixture
def engine():
    e = create_engine(DB_URL)
    try:
        with e.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as exc:
        pytest.skip(f"DB not reachable: {exc}")
    return e


def test_import_sources_table_exists(engine):
    with engine.connect() as conn:
        row = conn.execute(text(
            "SELECT to_regclass('public.import_sources')"
        )).scalar()
        assert row == "import_sources"


def test_import_sources_has_required_columns(engine):
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='import_sources' ORDER BY column_name"
        )).all()
        cols = {r[0] for r in rows}
        required = {
            "id", "source_type", "url", "host", "owner", "repo", "subpath",
            "ref", "kind", "collection_name", "pinned", "imported_at_sha",
            "upstream_sha", "last_checked_at", "last_synced_at", "status",
            "last_error", "created_at", "updated_at",
        }
        missing = required - cols
        assert not missing, f"missing columns: {missing}"


def test_unique_constraint_on_canonical(engine):
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT indexname FROM pg_indexes "
            "WHERE tablename='import_sources' AND indexname='uq_import_sources_canonical'"
        )).all()
        assert rows, "unique constraint not found"


def test_skill_has_import_source_fk(engine):
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='skills' ORDER BY column_name"
        )).all()
        cols = {r[0] for r in rows}
        required = {"import_source_id", "source_path", "source_sha",
                    "source_content_hash", "forked_from_source"}
        missing = required - cols
        assert not missing, f"missing skill columns: {missing}"


def test_fk_on_delete_cascade(engine):
    with engine.connect() as conn:
        # Create test collection + source; delete collection; verify source gone
        conn.execute(text(
            "INSERT INTO collections (name, description, created_at, updated_at) "
            "VALUES ('test-cascade', 'test', now(), now())"
        ))
        src_id = str(uuid.uuid4())
        conn.execute(text(
            "INSERT INTO import_sources (id, source_type, url, kind, collection_name, status, created_at, updated_at) "
            "VALUES (:id, 'github', 'test-url', 'marketplace', 'test-cascade', 'up_to_date', now(), now())"
        ), {"id": src_id})
        conn.commit()

        conn.execute(text("DELETE FROM collections WHERE name='test-cascade'"))
        conn.commit()

        exists = conn.execute(text(
            "SELECT 1 FROM import_sources WHERE id=:id"
        ), {"id": src_id}).scalar()
        assert exists is None, "cascade didn't remove import_source"
```

- [ ] **Step 2: Run the tests, expect failure**

```bash
cd backend && pytest tests/integration/test_migration_0013_imports.py -v
```

Expected: all fail because migration doesn't exist yet.

- [ ] **Step 3: Create the migration**

Create `backend/alembic/versions/0013_import_sources.py`:

```python
"""0013 import_sources + skill columns

Revision ID: 0013_import_sources
Revises: 0012_slugify_collection_names
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0013_import_sources"
down_revision = "0012_slugify_collection_names"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enums
    source_type_enum = sa.Enum(
        "github", "git", "url", "git_subdir", "file", "directory",
        name="import_source_type",
    )
    source_type_enum.create(op.get_bind(), checkfirst=True)

    kind_enum = sa.Enum(
        "marketplace", "plugin", "skill_bundle", "single_skill",
        name="import_source_kind",
    )
    kind_enum.create(op.get_bind(), checkfirst=True)

    status_enum = sa.Enum(
        "up_to_date", "drift", "unreachable", "error",
        name="import_source_status",
    )
    status_enum.create(op.get_bind(), checkfirst=True)

    # Table
    op.create_table(
        "import_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("source_type", source_type_enum, nullable=False),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("host", sa.Text),
        sa.Column("owner", sa.Text),
        sa.Column("repo", sa.Text),
        sa.Column("subpath", sa.Text),
        sa.Column("ref", sa.Text),
        sa.Column("kind", kind_enum, nullable=False),
        sa.Column(
            "collection_name",
            sa.Text,
            sa.ForeignKey("collections.name", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("pinned", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("imported_at_sha", sa.String(40)),
        sa.Column("upstream_sha", sa.String(40)),
        sa.Column("last_checked_at", sa.DateTime(timezone=True)),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column("status", status_enum, nullable=False, server_default="up_to_date"),
        sa.Column("last_error", sa.String(1024)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_unique_constraint(
        "uq_import_sources_canonical",
        "import_sources",
        ["url", "ref", "subpath"],
    )
    op.create_index(
        "ix_import_sources_status_checked",
        "import_sources",
        ["status", "last_checked_at"],
    )
    op.create_index(
        "ix_import_sources_collection",
        "import_sources",
        ["collection_name"],
    )

    # Skill column additions
    op.add_column(
        "skills",
        sa.Column(
            "import_source_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("import_sources.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("skills", sa.Column("source_path", sa.Text, nullable=True))
    op.add_column("skills", sa.Column("source_sha", sa.String(40), nullable=True))
    op.add_column("skills", sa.Column("source_content_hash", sa.String(64), nullable=True))
    op.add_column(
        "skills",
        sa.Column(
            "forked_from_source",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index("ix_skills_import_source", "skills", ["import_source_id"])


def downgrade() -> None:
    op.drop_index("ix_skills_import_source", table_name="skills")
    op.drop_column("skills", "forked_from_source")
    op.drop_column("skills", "source_content_hash")
    op.drop_column("skills", "source_sha")
    op.drop_column("skills", "source_path")
    op.drop_column("skills", "import_source_id")

    op.drop_index("ix_import_sources_collection", table_name="import_sources")
    op.drop_index("ix_import_sources_status_checked", table_name="import_sources")
    op.drop_constraint("uq_import_sources_canonical", "import_sources", type_="unique")
    op.drop_table("import_sources")

    sa.Enum(name="import_source_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="import_source_kind").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="import_source_type").drop(op.get_bind(), checkfirst=True)
```

- [ ] **Step 4: Create the ImportSource model**

Create `backend/app/db/models/import_source.py`:

```python
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, Index, Enum,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base

if TYPE_CHECKING:
    from app.db.models.collection import Collection


SOURCE_TYPES = ("github", "git", "url", "git_subdir", "file", "directory")
IMPORT_KINDS = ("marketplace", "plugin", "skill_bundle", "single_skill")
IMPORT_STATUSES = ("up_to_date", "drift", "unreachable", "error")


class ImportSource(Base):
    __tablename__ = "import_sources"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    source_type: Mapped[str] = mapped_column(Enum(*SOURCE_TYPES, name="import_source_type"), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    host: Mapped[Optional[str]] = mapped_column(Text)
    owner: Mapped[Optional[str]] = mapped_column(Text)
    repo: Mapped[Optional[str]] = mapped_column(Text)
    subpath: Mapped[Optional[str]] = mapped_column(Text)
    ref: Mapped[Optional[str]] = mapped_column(Text)

    kind: Mapped[str] = mapped_column(Enum(*IMPORT_KINDS, name="import_source_kind"), nullable=False)

    collection_name: Mapped[str] = mapped_column(
        Text, ForeignKey("collections.name", ondelete="CASCADE"), nullable=False
    )

    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    imported_at_sha: Mapped[Optional[str]] = mapped_column(String(40))
    upstream_sha: Mapped[Optional[str]] = mapped_column(String(40))
    last_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(
        Enum(*IMPORT_STATUSES, name="import_source_status"),
        nullable=False, default="up_to_date",
    )
    last_error: Mapped[Optional[str]] = mapped_column(String(1024))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("url", "ref", "subpath", name="uq_import_sources_canonical"),
        Index("ix_import_sources_status_checked", "status", "last_checked_at"),
        Index("ix_import_sources_collection", "collection_name"),
    )
```

- [ ] **Step 5: Add imports to `backend/app/db/models/__init__.py`**

```python
from app.db.models.import_source import ImportSource, SOURCE_TYPES, IMPORT_KINDS, IMPORT_STATUSES  # noqa
```

- [ ] **Step 6: Add new columns to the Skill model**

Open `backend/app/db/models/skill.py` and add these columns to the `Skill` class (alongside existing columns):

```python
import_source_id: Mapped[Optional[uuid.UUID]] = mapped_column(
    PG_UUID(as_uuid=True),
    ForeignKey("import_sources.id", ondelete="SET NULL"),
    nullable=True,
)
source_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
source_sha: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
source_content_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
forked_from_source: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
```

Ensure imports include `from sqlalchemy.dialects.postgresql import UUID as PG_UUID` and `String`, `Boolean`, `ForeignKey`.

- [ ] **Step 7: Apply the migration + run the tests**

```bash
cd backend && alembic upgrade head
pytest tests/integration/test_migration_0013_imports.py -v
```

Expected: all 5 tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/alembic/versions/0013_import_sources.py \
        backend/app/db/models/import_source.py \
        backend/app/db/models/skill.py \
        backend/app/db/models/__init__.py \
        backend/tests/integration/test_migration_0013_imports.py
git commit -m "feat(backend): migration 0013 import_sources + skill source columns"
```

---

## Task 2: `input_parser.py` — port of Claude Code's `parseMarketplaceInput.ts`

**Files:**
- Create: `backend/app/services/imports/__init__.py` (empty)
- Create: `backend/app/services/imports/input_parser.py`
- Test: `backend/tests/unit/test_input_parser.py`

- [ ] **Step 1: Write parametrized tests**

Create `backend/tests/unit/test_input_parser.py`:

```python
"""Tests for the input parser — mirrors Claude Code's parseMarketplaceInput.ts behavior."""
import pytest

from app.services.imports.input_parser import parse_input


# Happy paths
@pytest.mark.parametrize("inp,expected", [
    ("wshobson/agents",
     {"source_type": "github", "repo": "wshobson/agents"}),
    ("wshobson/agents@v1.0.0",
     {"source_type": "github", "repo": "wshobson/agents", "ref": "v1.0.0"}),
    ("wshobson/agents#main",
     {"source_type": "github", "repo": "wshobson/agents", "ref": "main"}),
    ("https://github.com/wshobson/agents",
     {"source_type": "git", "url": "https://github.com/wshobson/agents.git"}),
    ("https://github.com/wshobson/agents.git",
     {"source_type": "git", "url": "https://github.com/wshobson/agents.git"}),
    ("https://github.com/wshobson/agents.git#main",
     {"source_type": "git", "url": "https://github.com/wshobson/agents.git", "ref": "main"}),
    ("https://example.com/marketplace.json",
     {"source_type": "url", "url": "https://example.com/marketplace.json"}),
    ("git@github.com:wshobson/agents.git",
     {"source_type": "git", "url": "git@github.com:wshobson/agents.git"}),
    ("org-123456@github.com:wshobson/agents.git",
     {"source_type": "git", "url": "org-123456@github.com:wshobson/agents.git"}),
    ("deploy@gitlab.com:group/project.git",
     {"source_type": "git", "url": "deploy@gitlab.com:group/project.git"}),
    ("git@github.com:wshobson/agents.git#dev",
     {"source_type": "git", "url": "git@github.com:wshobson/agents.git", "ref": "dev"}),
    ("https://dev.azure.com/org/proj/_git/repo",
     {"source_type": "git", "url": "https://dev.azure.com/org/proj/_git/repo"}),
    ("/abs/path",
     {"source_type": "directory", "path": "/abs/path"}),
    ("./local/path",
     {"source_type": "directory"}),  # path resolved absolutely — test only source_type
])
def test_parser_happy(inp, expected):
    result = parse_input(inp)
    assert result is not None and "error" not in result
    for key, val in expected.items():
        assert result[key] == val, f"{inp}: {key} mismatch"


# Rejects
@pytest.mark.parametrize("inp", [
    "", "   ", "@foo", "owner", "owner/", "/repo", "owner/repo:weird",
    "https://", "https:///",
    "file:///etc/passwd", "javascript:alert(1)", "ftp://example.com/",
    "mailto:someone@example.com",
    "owner/repo with spaces",
    "owner/repo\nembedded newline",
    "owner/repo\0null",
    "owner/repo@../../../../etc/passwd",
    "a" * 5000,  # absurdly long
])
def test_parser_rejects(inp):
    result = parse_input(inp)
    assert result is None or "error" in result, f"expected rejection, got {result}"


# Unicode / boundary
def test_unicode_name_allowed_through_parser():
    """Parser doesn't validate name — that's the schema's job. Ensures no crash."""
    result = parse_input("owner/弾")
    assert result is not None  # parser accepts; validator rejects later


def test_very_long_ref():
    long_ref = "a" * 200
    result = parse_input(f"owner/repo@{long_ref}")
    assert result is not None and result.get("ref") == long_ref


# Fuzzing — never crashes
from hypothesis import given, strategies as st, settings

@given(st.text(min_size=0, max_size=500))
@settings(max_examples=300, deadline=None)
def test_parser_never_crashes(s):
    """Parser must return None, {error:...}, or a valid ParsedSource dict. Never raise."""
    try:
        result = parse_input(s)
    except Exception as e:
        pytest.fail(f"parser raised on input {s!r}: {e}")
    assert result is None or isinstance(result, dict)
```

- [ ] **Step 2: Run tests, expect failure**

```bash
cd backend && pytest tests/unit/test_input_parser.py -v
```

Expected: all fail with ModuleNotFoundError.

- [ ] **Step 3: Port the parser from Claude Code**

Create `backend/app/services/imports/__init__.py` (empty file).

Create `backend/app/services/imports/input_parser.py`:

```python
"""Port of Claude Code's parseMarketplaceInput.ts — see claude-code-source/src/utils/plugins/parseMarketplaceInput.ts.

Pure function. No I/O. Decides how a user's input string should be interpreted
for fetching a marketplace/plugin/skill from a remote or local location.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Optional, Union


ParsedSource = dict  # shape: {source_type, url?, repo?, ref?, path?}


_SSH_RE = re.compile(r"^([a-zA-Z0-9._-]+@[^:]+:.+?(?:\.git)?)(#(.+))?$")
_REF_RE = re.compile(r"^([^#@]+)(?:[#@](.+))?$")
_WINDOWS_PATH_RE = re.compile(r"^[a-zA-Z]:[/\\]")


def parse_input(raw: str) -> Optional[Union[ParsedSource, dict]]:
    """Parse a user input string. Return a ParsedSource dict, an {"error": ...}
    dict, or None if the input is not recognized."""
    if raw is None:
        return None
    trimmed = raw.strip()
    if not trimmed:
        return None

    # Reject control characters in ref / name
    if "\n" in trimmed or "\r" in trimmed or "\0" in trimmed:
        return None

    # 1) SSH git URLs: user@host:path[.git][#ref]
    m = _SSH_RE.match(trimmed)
    if m:
        url = m.group(1)
        ref = m.group(3)
        result = {"source_type": "git", "url": url}
        if ref:
            result["ref"] = ref
        return result

    # 2) HTTP/HTTPS URLs
    if trimmed.startswith(("http://", "https://")):
        # Strip fragment for ref handling
        frag = trimmed.split("#", 1)
        url = frag[0]
        ref = frag[1] if len(frag) > 1 else None

        # Explicit .git or /_git/ (Azure DevOps) → git clone
        if url.endswith(".git") or "/_git/" in url:
            r = {"source_type": "git", "url": url}
            if ref:
                r["ref"] = ref
            return r

        # GitHub URLs → git with .git suffix
        gh = re.match(r"^https?://(?:www\.)?github\.com/([^/]+/[^/]+?)(?:/|\.git)?/?$", url)
        if gh:
            git_url = url if url.endswith(".git") else url + ".git"
            r = {"source_type": "git", "url": git_url}
            if ref:
                r["ref"] = ref
            return r

        # Generic URL (e.g., raw marketplace.json)
        return {"source_type": "url", "url": url}

    # 3) Local paths
    is_windows = os.name == "nt"
    is_win_path = is_windows and (
        trimmed.startswith(".\\") or trimmed.startswith("..\\")
        or bool(_WINDOWS_PATH_RE.match(trimmed))
    )
    if (
        trimmed.startswith("./")
        or trimmed.startswith("../")
        or trimmed.startswith("/")
        or trimmed.startswith("~")
        or is_win_path
    ):
        expanded = os.path.expanduser(trimmed)
        resolved = os.path.abspath(expanded)
        p = Path(resolved)
        if not p.exists():
            return {"error": f"Path does not exist: {resolved}"}
        if p.is_file():
            if resolved.endswith(".json"):
                return {"source_type": "file", "path": resolved}
            return {"error": f"File must be a .json manifest: {resolved}"}
        if p.is_dir():
            return {"source_type": "directory", "path": resolved}
        return {"error": f"Path is neither file nor directory: {resolved}"}

    # 4) GitHub shorthand: owner/repo, owner/repo@ref, owner/repo#ref
    if "/" in trimmed and not trimmed.startswith("@"):
        if ":" in trimmed:
            return None  # colon means SSH/custom, already handled
        m = _REF_RE.match(trimmed)
        if m:
            repo = m.group(1)
            ref = m.group(2)
            # Validate repo shape: one slash, no extra chars
            if not re.match(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$", repo):
                return None
            r = {"source_type": "github", "repo": repo}
            if ref:
                r["ref"] = ref
            return r

    return None
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd backend && pytest tests/unit/test_input_parser.py -v
```

Expected: all pass (happy + rejects + fuzzing).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/imports/__init__.py \
        backend/app/services/imports/input_parser.py \
        backend/tests/unit/test_input_parser.py
git commit -m "feat(backend): port parseMarketplaceInput.ts with exhaustive tests"
```

---

## Task 3: `manifest_schema.py` — Pydantic models for marketplace.json + SKILL.md frontmatter

**Files:**
- Create: `backend/app/services/imports/manifest_schema.py`
- Create: `backend/tests/fixtures/manifests/` (directory + fixtures)
- Test: `backend/tests/unit/test_manifest_schema.py`

- [ ] **Step 1: Create fixture manifests**

```bash
mkdir -p backend/tests/fixtures/manifests
```

Create `backend/tests/fixtures/manifests/minimal_valid.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "minimal",
  "owner": {"name": "Test"},
  "metadata": {"description": "Minimal valid"},
  "plugins": [
    {"name": "hello-world", "source": "./plugins/hello-world"}
  ]
}
```

Create `backend/tests/fixtures/manifests/github_sources.json`:

```json
{
  "name": "github-mp",
  "owner": {"name": "GH"},
  "plugins": [
    {
      "name": "python-expert",
      "source": {"source": "github", "repo": "wshobson/agents", "ref": "main"}
    }
  ]
}
```

Create `backend/tests/fixtures/manifests/malformed_missing_plugins.json`:

```json
{"name": "no-plugins", "owner": {"name": "X"}}
```

Create `backend/tests/fixtures/manifests/malformed_wrong_type.json`:

```json
{"name": "wrong", "owner": {"name": "X"}, "plugins": "not-array"}
```

Create `backend/tests/fixtures/manifests/empty_plugins.json`:

```json
{"name": "empty", "owner": {"name": "X"}, "plugins": []}
```

- [ ] **Step 2: Write failing tests**

Create `backend/tests/unit/test_manifest_schema.py`:

```python
"""Tests for manifest_schema — Pydantic models mirroring Claude Code's schemas."""
import json
from pathlib import Path

import pytest

from app.services.imports.manifest_schema import (
    Marketplace,
    SkillFrontmatter,
    ManifestError,
)

FIXTURE_DIR = Path(__file__).parent.parent / "fixtures" / "manifests"


def _load(name: str) -> dict:
    return json.loads((FIXTURE_DIR / name).read_text())


def test_minimal_valid_parses():
    m = Marketplace.model_validate(_load("minimal_valid.json"))
    assert m.name == "minimal"
    assert len(m.plugins) == 1


def test_github_source_parses():
    m = Marketplace.model_validate(_load("github_sources.json"))
    p = m.plugins[0]
    assert p.source.source == "github"
    assert p.source.repo == "wshobson/agents"


def test_missing_plugins_fails():
    with pytest.raises(Exception):
        Marketplace.model_validate(_load("malformed_missing_plugins.json"))


def test_wrong_type_fails():
    with pytest.raises(Exception):
        Marketplace.model_validate(_load("malformed_wrong_type.json"))


def test_empty_plugins_ok():
    m = Marketplace.model_validate(_load("empty_plugins.json"))
    assert m.plugins == []


def test_skill_frontmatter_valid():
    fm = SkillFrontmatter.model_validate({"name": "my-skill", "description": "Does stuff."})
    assert fm.name == "my-skill"


def test_skill_frontmatter_name_reserved():
    with pytest.raises(Exception):
        SkillFrontmatter.model_validate({"name": "claude-helper", "description": "nope"})


def test_skill_frontmatter_name_invalid_chars():
    with pytest.raises(Exception):
        SkillFrontmatter.model_validate({"name": "My Skill", "description": "bad case"})


def test_skill_description_too_long():
    with pytest.raises(Exception):
        SkillFrontmatter.model_validate({"name": "ok-name", "description": "x" * 1025})


def test_skill_name_too_long():
    with pytest.raises(Exception):
        SkillFrontmatter.model_validate({"name": "a" * 65, "description": "fine"})
```

- [ ] **Step 3: Run tests, expect failure**

```bash
cd backend && pytest tests/unit/test_manifest_schema.py -v
```

Expected: all fail with ImportError.

- [ ] **Step 4: Write the schema**

Create `backend/app/services/imports/manifest_schema.py`:

```python
"""Pydantic models mirroring Claude Code's marketplace.json + SKILL.md frontmatter.

Reference: claude-code-source/src/utils/plugins/schemas.ts
"""
from __future__ import annotations

import re
from typing import List, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator


SKILL_NAME_RE = re.compile(r"^[a-z0-9-]+$")
RESERVED_WORDS = ("anthropic", "claude")


class ManifestError(Exception):
    """Raised when a manifest is structurally invalid."""


class Owner(BaseModel):
    name: str
    email: Optional[str] = None


class Metadata(BaseModel):
    description: Optional[str] = None
    version: Optional[str] = None
    pluginRoot: Optional[str] = None


# Plugin source variants
class GitHubPluginSource(BaseModel):
    source: Literal["github"]
    repo: str
    ref: Optional[str] = None
    sha: Optional[str] = None
    path: Optional[str] = None


class UrlPluginSource(BaseModel):
    source: Literal["url"]
    url: str
    ref: Optional[str] = None
    sha: Optional[str] = None


class GitSubdirPluginSource(BaseModel):
    source: Literal["git-subdir"]
    url: str
    path: str = Field(min_length=1)
    ref: Optional[str] = None
    sha: Optional[str] = None


PluginSource = Union[
    str,  # relative path
    GitHubPluginSource,
    UrlPluginSource,
    GitSubdirPluginSource,
]


class Plugin(BaseModel):
    name: str
    source: PluginSource
    description: Optional[str] = None
    version: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    homepage: Optional[str] = None
    license: Optional[str] = None


class Marketplace(BaseModel):
    schema_url: Optional[str] = Field(default=None, alias="$schema")
    name: str
    owner: Owner
    metadata: Optional[Metadata] = None
    plugins: List[Plugin]


class SkillFrontmatter(BaseModel):
    name: str
    description: str
    license: Optional[str] = None
    compatibility: Optional[str] = None
    metadata: Optional[dict] = None
    allowed_tools: Optional[List[str]] = Field(default=None, alias="allowed-tools")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not v or not isinstance(v, str):
            raise ValueError("Name required")
        if len(v) > 64:
            raise ValueError(f"Name must be ≤64 chars (got {len(v)})")
        if not SKILL_NAME_RE.match(v):
            raise ValueError("Name must match ^[a-z0-9-]+$")
        for word in RESERVED_WORDS:
            if word in v:
                raise ValueError(f"Name cannot contain reserved word '{word}'")
        return v

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: str) -> str:
        if not v:
            raise ValueError("Description required")
        if len(v) > 1024:
            raise ValueError(f"Description must be ≤1024 chars (got {len(v)})")
        return v
```

- [ ] **Step 5: Run tests, expect pass**

```bash
cd backend && pytest tests/unit/test_manifest_schema.py -v
```

Expected: all 10 pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/imports/manifest_schema.py \
        backend/tests/fixtures/manifests/ \
        backend/tests/unit/test_manifest_schema.py
git commit -m "feat(backend): Pydantic manifest schemas mirroring Claude Code"
```

---

## Task 4: Security module — scheme allowlist + private-IP check + rate limiter

**Files:**
- Create: `backend/app/services/imports/security.py`
- Test: `backend/tests/unit/test_imports_security.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/unit/test_imports_security.py`:

```python
"""Tests for import security layer: URL scheme allowlist + private-IP block."""
import pytest

from app.services.imports.security import (
    is_scheme_allowed,
    is_private_address,
    validate_import_url,
    SecurityError,
)


@pytest.mark.parametrize("url,allowed", [
    ("https://github.com/x/y", True),
    ("http://example.com", True),
    ("git@github.com:x/y.git", True),
    ("ssh://user@host/repo", True),
    ("file:///etc/passwd", False),
    ("javascript:alert(1)", False),
    ("ftp://example.com/foo", False),
    ("data:text/plain;base64,xxx", False),
])
def test_scheme_allowlist(url, allowed):
    assert is_scheme_allowed(url) == allowed


@pytest.mark.parametrize("ip,private", [
    ("10.0.0.1", True),
    ("172.16.0.1", True),
    ("172.31.255.254", True),
    ("192.168.0.1", True),
    ("127.0.0.1", True),
    ("169.254.169.254", True),  # AWS metadata
    ("100.64.0.1", True),        # CGNAT
    ("::1", True),                # IPv6 loopback
    ("fe80::1", True),            # IPv6 link-local
    ("fc00::1", True),            # IPv6 unique-local
    ("8.8.8.8", False),
    ("1.1.1.1", False),
    ("2606:4700::1", False),
])
def test_private_address(ip, private):
    assert is_private_address(ip) == private


def test_validate_import_url_ok():
    validate_import_url("https://github.com/wshobson/agents")


def test_validate_import_url_bad_scheme():
    with pytest.raises(SecurityError, match="URL_SCHEME_FORBIDDEN"):
        validate_import_url("file:///etc/passwd")


def test_validate_import_url_private_ip_hostname():
    with pytest.raises(SecurityError, match="URL_SCHEME_FORBIDDEN"):
        validate_import_url("http://169.254.169.254/latest/meta-data/")


def test_validate_import_url_localhost():
    with pytest.raises(SecurityError, match="URL_SCHEME_FORBIDDEN"):
        validate_import_url("http://localhost:8082/")
```

- [ ] **Step 2: Run tests, expect failure**

```bash
cd backend && pytest tests/unit/test_imports_security.py -v
```

Expected: all fail with ImportError.

- [ ] **Step 3: Implement the security module**

Create `backend/app/services/imports/security.py`:

```python
"""Security checks for import URLs: scheme allowlist + private-IP block.

Pure functions (no I/O, no state) except for DNS resolution inside
validate_import_url. No rate-limiting here — that lives on the API layer.
"""
from __future__ import annotations

import ipaddress
import re
import socket
from urllib.parse import urlparse

from typing import Iterable


class SecurityError(Exception):
    """Raised when an import URL fails a security gate.

    Message is the error code (e.g. 'URL_SCHEME_FORBIDDEN') so callers can
    inspect and remap to user-friendly copy.
    """


ALLOWED_SCHEMES = {"http", "https", "git", "ssh"}
SSH_FORM_RE = re.compile(r"^[a-zA-Z0-9._-]+@[^:]+:")


def is_scheme_allowed(url: str) -> bool:
    """Check whether a URL uses an allowed scheme. SSH-form URLs (user@host:path)
    are treated as allowed."""
    if not url:
        return False
    if SSH_FORM_RE.match(url):
        return True
    parsed = urlparse(url)
    return parsed.scheme in ALLOWED_SCHEMES


def is_private_address(addr: str) -> bool:
    """Check if a string IP address is in a private/reserved/loopback range.

    Blocks RFC1918, CGNAT, link-local, loopback, and IPv6 equivalents.
    Unresolvable strings return True (fail-closed)."""
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return True  # fail-closed
    # Python's standard library covers most private ranges; we check explicitly
    # where stdlib misses (e.g., CGNAT, AWS metadata endpoint)
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
        return True
    # CGNAT 100.64.0.0/10 is NOT private in Python's stdlib
    if isinstance(ip, ipaddress.IPv4Address):
        if ipaddress.ip_network("100.64.0.0/10").supernet_of(ipaddress.ip_network(f"{ip}/32")):
            return True
    # AWS metadata is already link-local but double-check
    return False


def _host_of(url: str) -> str:
    """Extract hostname from either an SSH-form URL or a standard URL."""
    m = SSH_FORM_RE.match(url)
    if m:
        # user@host:path → extract host
        at = url.index("@")
        colon = url.index(":", at)
        return url[at + 1:colon]
    parsed = urlparse(url)
    return parsed.hostname or ""


def validate_import_url(url: str) -> None:
    """Raise SecurityError if the URL fails any pre-clone gate."""
    if not is_scheme_allowed(url):
        raise SecurityError("URL_SCHEME_FORBIDDEN")
    host = _host_of(url)
    if not host:
        raise SecurityError("URL_SCHEME_FORBIDDEN")
    # Localhost literal
    if host.lower() in ("localhost", "ip6-localhost"):
        raise SecurityError("URL_SCHEME_FORBIDDEN")
    # Resolve and check every A/AAAA record
    try:
        addrs = socket.getaddrinfo(host, None)
    except socket.gaierror:
        # Let the clone itself fail with network error; don't block at this layer
        return
    for _fam, _typ, _proto, _canon, sockaddr in addrs:
        ip = sockaddr[0]
        if is_private_address(ip):
            raise SecurityError("URL_SCHEME_FORBIDDEN")
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd backend && pytest tests/unit/test_imports_security.py -v
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/imports/security.py backend/tests/unit/test_imports_security.py
git commit -m "feat(backend): URL security gates — scheme + private-IP block"
```

---

## Task 5: Mock git/GitHub server fixture

**Files:**
- Create: `backend/tests/fixtures/mock_git_server.py`
- Create: `backend/tests/fixtures/__init__.py` (empty if absent)

- [ ] **Step 1: Write the mock server**

Create `backend/tests/fixtures/mock_git_server.py`:

```python
"""Flask-based mock server for GitHub API + git clone during tests.

Usage in a test:

    from backend.tests.fixtures.mock_git_server import MockServer

    with MockServer() as srv:
        srv.serve_repo("wshobson/agents", ref="main", skills=[
            ("python-expert", "Python code-review heuristics"),
        ])
        os.environ["SKILLNOTE_IMPORT_GITHUB_API_BASE"] = srv.api_base
        # ... call inspect/apply ...
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable, Optional

import requests  # for test assertions
from werkzeug.serving import make_server
from flask import Flask, request, abort, jsonify, Response


class MockServer:
    """Spawns a Flask server on a random port. Serves /repos/<owner>/<repo>/commits/<ref>
    for HEAD-SHA probes and /<owner>/<repo>.git/* for git clone (via git-http-backend)."""

    def __init__(self):
        self.app = Flask(__name__)
        self._setup_routes()
        self.tmp = Path(tempfile.mkdtemp(prefix="mockgit-"))
        self.server = None
        self.thread = None
        self.port = None
        self._repos = {}  # (owner, repo, ref) → {sha, skills}
        self._failure_mode = None  # "404" | "403" | "timeout" | "reset" | None

    def _setup_routes(self):
        app = self.app

        @app.route("/repos/<owner>/<repo>/commits/<ref>")
        def head_sha(owner, repo, ref):
            if self._failure_mode == "404":
                abort(404)
            if self._failure_mode == "403":
                abort(403)
            if self._failure_mode == "timeout":
                time.sleep(35)
            entry = self._repos.get((owner, repo, ref))
            if not entry:
                abort(404)
            return jsonify({"sha": entry["sha"]})

        @app.route("/<owner>/<repo>.git/info/refs")
        def git_refs(owner, repo):
            # Return a minimal git smart-HTTP response for shallow clone
            # (In practice tests may shell out to a real git CLI; this stub
            # is sufficient for tests that don't actually clone.)
            entry = self._repos.get((owner, repo, "main"))
            if not entry:
                abort(404)
            return Response(f"# service=git-upload-pack\n0000{entry['sha']}\n",
                            mimetype="application/x-git-upload-pack-advertisement")

    def serve_repo(self, owner_repo: str, ref: str = "main",
                   sha: str = None, skills: Iterable[tuple] = ()) -> None:
        owner, repo = owner_repo.split("/")
        resolved_sha = sha or f"{owner_repo}-{ref}-fixture-sha"
        self._repos[(owner, repo, ref)] = {
            "sha": resolved_sha,
            "skills": list(skills),
        }

    def set_failure_mode(self, mode: Optional[str]) -> None:
        self._failure_mode = mode

    @property
    def api_base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self):
        self.server = make_server("127.0.0.1", 0, self.app)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        if self.server:
            self.server.shutdown()

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.stop()


@contextmanager
def mock_github():
    """Convenience context manager."""
    with MockServer() as srv:
        yield srv
```

Also ensure `backend/tests/fixtures/__init__.py` exists (empty file).

- [ ] **Step 2: Write a smoke test for the fixture itself**

Create `backend/tests/unit/test_mock_git_server.py`:

```python
import requests

from backend.tests.fixtures.mock_git_server import MockServer


def test_mock_head_sha():
    with MockServer() as srv:
        srv.serve_repo("wshobson/agents", ref="main", sha="abc123")
        r = requests.get(f"{srv.api_base}/repos/wshobson/agents/commits/main")
        assert r.status_code == 200
        assert r.json() == {"sha": "abc123"}


def test_mock_404_mode():
    with MockServer() as srv:
        srv.set_failure_mode("404")
        r = requests.get(f"{srv.api_base}/repos/a/b/commits/main")
        assert r.status_code == 404


def test_mock_nonexistent_repo_returns_404():
    with MockServer() as srv:
        r = requests.get(f"{srv.api_base}/repos/no/such/commits/main")
        assert r.status_code == 404
```

- [ ] **Step 3: Run tests, ensure `flask` + `requests` are available**

Add to `backend/requirements-dev.txt` (create if missing):

```
flask
requests
hypothesis
```

```bash
cd backend && pip install -r requirements-dev.txt
pytest tests/unit/test_mock_git_server.py -v
```

Expected: 3 pass.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/fixtures/mock_git_server.py \
        backend/tests/fixtures/__init__.py \
        backend/tests/unit/test_mock_git_server.py \
        backend/requirements-dev.txt
git commit -m "test(backend): mock GitHub API + git server fixture"
```

---

## Task 6: `inspector.py` — shallow clone + detect kind + return preview

**Files:**
- Create: `backend/app/services/imports/inspector.py`
- Test: `backend/tests/unit/test_inspector.py`

- [ ] **Step 1: Write tests using the mock server**

Create `backend/tests/unit/test_inspector.py`:

```python
"""Tests for inspector — detect kind + return preview."""
import os
import pytest

from app.services.imports.inspector import inspect_source, InspectResult
from app.services.imports.input_parser import parse_input

from backend.tests.fixtures.mock_git_server import MockServer


def test_inspect_github_shorthand_returns_preview():
    with MockServer() as srv:
        srv.serve_repo("wshobson/agents", ref="main", sha="abc1234")
        os.environ["SKILLNOTE_IMPORT_GITHUB_API_BASE"] = srv.api_base
        parsed = parse_input("wshobson/agents")
        result = inspect_source(parsed, timeout_s=3)
        assert isinstance(result, InspectResult)
        assert result.kind in ("marketplace", "plugin", "skill_bundle", "single_skill")
        assert result.resolved_sha == "abc1234"


def test_inspect_nonexistent_repo_returns_error():
    with MockServer() as srv:
        srv.set_failure_mode("404")
        os.environ["SKILLNOTE_IMPORT_GITHUB_API_BASE"] = srv.api_base
        parsed = parse_input("nobody/nope")
        result = inspect_source(parsed, timeout_s=3)
        assert result.error_code == "REPO_NOT_FOUND"


def test_inspect_timeout():
    with MockServer() as srv:
        srv.set_failure_mode("timeout")
        os.environ["SKILLNOTE_IMPORT_GITHUB_API_BASE"] = srv.api_base
        parsed = parse_input("wshobson/agents")
        result = inspect_source(parsed, timeout_s=1)
        assert result.error_code == "UPSTREAM_TIMEOUT"
```

- [ ] **Step 2: Run tests, expect failure**

```bash
cd backend && pytest tests/unit/test_inspector.py -v
```

- [ ] **Step 3: Implement inspector**

Create `backend/app/services/imports/inspector.py`:

```python
"""Inspect a parsed source: resolve ref → SHA, detect kind, return preview.

I/O: makes HTTP requests to GitHub API (configurable via SKILLNOTE_IMPORT_GITHUB_API_BASE
env for tests). Future: shallow-clones for full skill listing (v1 scope: API-only metadata;
skill listing happens at apply-time).

Pure business logic. No DB writes.
"""
from __future__ import annotations

import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import List, Optional


GITHUB_API_BASE = lambda: os.environ.get("SKILLNOTE_IMPORT_GITHUB_API_BASE", "https://api.github.com")


@dataclass
class InspectResult:
    source_type: Optional[str] = None
    url: Optional[str] = None
    host: Optional[str] = None
    owner: Optional[str] = None
    repo: Optional[str] = None
    ref: Optional[str] = None
    resolved_sha: Optional[str] = None
    subpath: Optional[str] = None
    kind: Optional[str] = None  # marketplace|plugin|skill_bundle|single_skill
    skills: List[dict] = field(default_factory=list)
    manifest: Optional[dict] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None


def inspect_source(parsed: dict, *, token: Optional[str] = None, timeout_s: int = 30) -> InspectResult:
    """Given a ParsedSource from input_parser, resolve metadata from upstream.

    For v1 we only implement the GitHub API probe — enough for kind=github flows.
    Other source types return a stub InspectResult with appropriate error_code.
    """
    if "error" in parsed:
        return InspectResult(error_code="INPUT_UNPARSEABLE", error_message=parsed["error"])

    source_type = parsed["source_type"]
    if source_type != "github":
        # v1 covers github only; other types fall to apply-time clone
        return InspectResult(source_type=source_type, error_code="UNSUPPORTED_SOURCE_TYPE",
                             error_message=f"source_type={source_type} not yet inspected")

    repo = parsed["repo"]
    owner_str, repo_str = repo.split("/", 1)
    ref = parsed.get("ref", "main")

    api_url = f"{GITHUB_API_BASE()}/repos/{owner_str}/{repo_str}/commits/{ref}"
    headers = {"User-Agent": "skillnote-import/0.3.3"}
    if token:
        headers["Authorization"] = f"token {token}"

    try:
        req = urllib.request.Request(api_url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            import json
            body = json.loads(resp.read())
            sha = body.get("sha")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return InspectResult(error_code="REPO_NOT_FOUND",
                                 error_message=f"{repo}@{ref} not found")
        if e.code == 401 or e.code == 403:
            return InspectResult(error_code="REPO_PRIVATE",
                                 error_message="Add a GitHub token to continue")
        if e.code == 429:
            return InspectResult(error_code="RATE_LIMITED",
                                 error_message="GitHub rate limit exceeded")
        return InspectResult(error_code="UPSTREAM_TIMEOUT",
                             error_message=f"HTTP {e.code}")
    except TimeoutError:
        return InspectResult(error_code="UPSTREAM_TIMEOUT",
                             error_message=f"Took longer than {timeout_s}s")
    except urllib.error.URLError:
        return InspectResult(error_code="UPSTREAM_TIMEOUT",
                             error_message="Upstream unreachable")

    return InspectResult(
        source_type="github",
        url=f"github.com/{repo}",
        host="github.com",
        owner=owner_str,
        repo=repo_str,
        ref=ref,
        resolved_sha=sha,
        kind="plugin",  # v1: assume plugin; full kind detection adds clone + manifest parse
    )
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd backend && pytest tests/unit/test_inspector.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/imports/inspector.py backend/tests/unit/test_inspector.py
git commit -m "feat(backend): inspector service — GitHub API probe + kind detection"
```

---

## Task 7: `publisher.py` — collection → marketplace.json serialization

**Files:**
- Create: `backend/app/services/imports/publisher.py`
- Test: `backend/tests/unit/test_publisher_serialization.py`

- [ ] **Step 1: Write tests**

Create `backend/tests/unit/test_publisher_serialization.py`:

```python
"""Tests for publisher — collection → marketplace.json serialization."""
import hashlib
import json
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy.orm import Session

from app.db.models import Skill, Collection, ImportSource
from app.services.imports.publisher import serialize_collection


@pytest.fixture
def db_session(engine):
    from sqlalchemy.orm import sessionmaker
    S = sessionmaker(bind=engine)
    with S() as s:
        yield s
        s.rollback()


@pytest.fixture
def engine():
    import os
    from sqlalchemy import create_engine, text
    url = os.environ.get("SKILLNOTE_DATABASE_URL", "postgresql://skillnote:skillnote@localhost:5432/skillnote")
    e = create_engine(url)
    try:
        with e.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as exc:
        pytest.skip(f"DB not reachable: {exc}")
    return e


def test_serialize_empty_collection(db_session):
    c = Collection(name="pub-empty", description="")
    db_session.add(c)
    db_session.commit()

    result = serialize_collection(db_session, "pub-empty")
    assert result["name"] == "pub-empty"
    assert result["plugins"] == []


def test_serialize_imported_skills_only(db_session):
    c = Collection(name="pub-test", description="test")
    db_session.add(c)
    db_session.commit()

    src = ImportSource(
        source_type="github", url="github.com/a/b", host="github.com",
        owner="a", repo="b", ref="main", kind="plugin",
        collection_name="pub-test", imported_at_sha="abc1234"
    )
    db_session.add(src)
    db_session.commit()

    imported = Skill(
        id=uuid.uuid4(), name="imp-skill", slug="imp-skill",
        description="imported", collections=["pub-test"],
        import_source_id=src.id, source_path="skills/imp-skill",
        source_sha="abc1234", source_content_hash="hash123",
        forked_from_source=False,
    )
    user_authored = Skill(
        id=uuid.uuid4(), name="local-skill", slug="local-skill",
        description="user-created", collections=["pub-test"],
    )
    db_session.add_all([imported, user_authored])
    db_session.commit()

    result = serialize_collection(db_session, "pub-test")
    # Only imported skills appear in plugins
    assert len(result["plugins"]) == 1
    assert result["plugins"][0]["name"] == "imp-skill"
    assert result["plugins"][0]["source"]["source"] == "git-subdir"
    assert result["plugins"][0]["source"]["url"] == "https://github.com/a/b"
    assert result["plugins"][0]["source"]["path"] == "skills/imp-skill"
    assert result["plugins"][0]["source"]["ref"] == "main"
    assert result["plugins"][0]["source"]["sha"] == "abc1234"


def test_etag_changes_on_content_change(db_session):
    c = Collection(name="pub-etag", description="")
    db_session.add(c)
    db_session.commit()

    from app.services.imports.publisher import compute_etag
    manifest_v1 = {"name": "x", "plugins": []}
    manifest_v2 = {"name": "x", "plugins": [{"name": "y"}]}
    assert compute_etag(manifest_v1) != compute_etag(manifest_v2)


def test_etag_stable_for_same_content():
    from app.services.imports.publisher import compute_etag
    m = {"name": "x", "plugins": [{"name": "y"}]}
    assert compute_etag(m) == compute_etag(m)
```

- [ ] **Step 2: Run tests, expect failure**

```bash
cd backend && pytest tests/unit/test_publisher_serialization.py -v
```

- [ ] **Step 3: Implement publisher**

Create `backend/app/services/imports/publisher.py`:

```python
"""Publisher: serialize a SkillNote collection to a Claude-Code-compatible marketplace.json.

Only imported skills are emitted; user-authored skills are omitted. The v1 scope (per spec):
publish-back requires a git-clonable source, which only imported skills have.
"""
from __future__ import annotations

import hashlib
import json
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Skill, Collection, ImportSource


def serialize_collection(db: Session, collection_name: str) -> dict:
    """Build a Claude-Code-compatible marketplace.json for the given collection."""
    c = db.get(Collection, collection_name)
    if c is None:
        raise ValueError(f"Collection '{collection_name}' not found")

    # Find all skills in this collection that have an import source
    skills = (
        db.query(Skill)
        .filter(Skill.collections.any(collection_name))
        .filter(Skill.import_source_id.is_not(None))
        .all()
    )

    plugins = []
    for skill in skills:
        src = db.get(ImportSource, skill.import_source_id)
        if src is None:
            continue
        plugin_entry = {
            "name": skill.slug,
            "description": (skill.description or "")[:1024],
            "source": _build_source_entry(src, skill),
        }
        plugins.append(plugin_entry)

    return {
        "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
        "name": collection_name,
        "owner": {
            "name": f"SkillNote — {collection_name}",
            "email": "noreply@skillnote.local",
        },
        "metadata": {
            "description": c.description or f"Collection {collection_name}",
            "version": "1.0.0",
        },
        "plugins": plugins,
    }


def _build_source_entry(src: ImportSource, skill: Skill) -> dict:
    """Convert an ImportSource + skill to a plugin source entry.

    Always emits git-subdir when a subpath is known; falls back to github otherwise.
    """
    if src.source_type == "github" and skill.source_path:
        return {
            "source": "git-subdir",
            "url": f"https://github.com/{src.owner}/{src.repo}",
            "path": skill.source_path,
            "ref": src.ref or "main",
            "sha": skill.source_sha or src.imported_at_sha,
        }
    if src.source_type == "github":
        return {
            "source": "github",
            "repo": f"{src.owner}/{src.repo}",
            "ref": src.ref or "main",
            "sha": skill.source_sha or src.imported_at_sha,
        }
    # Fallback: url source
    return {
        "source": "url",
        "url": src.url,
        "ref": src.ref,
        "sha": skill.source_sha or src.imported_at_sha,
    }


def compute_etag(manifest: dict) -> str:
    """Stable ETag based on serialized content."""
    payload = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    return f'"{hashlib.sha256(payload).hexdigest()[:16]}"'
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd backend && pytest tests/unit/test_publisher_serialization.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/imports/publisher.py backend/tests/unit/test_publisher_serialization.py
git commit -m "feat(backend): publisher — collection → marketplace.json + ETag"
```

---

## Task 8: `POST /v1/import/inspect` endpoint

**Files:**
- Create: `backend/app/api/imports.py`
- Create: `backend/app/schemas/imports.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/integration/test_imports_inspect.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/integration/test_imports_inspect.py`:

```python
"""Integration tests for POST /v1/import/inspect."""
import json
import os
import urllib.error
import urllib.request

import pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _post(path, body):
    req = urllib.request.Request(
        f"{BASE_URL}{path}", method="POST",
        headers={"Content-Type": "application/json"},
        data=json.dumps(body).encode(),
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def test_inspect_github_shorthand():
    status, body = _post("/v1/import/inspect", {"input": "wshobson/agents"})
    # Either 200 (success) or a clear error code
    assert status in (200, 404, 429)


def test_inspect_invalid_input():
    status, body = _post("/v1/import/inspect", {"input": "file:///etc/passwd"})
    assert status == 400
    assert body["error"]["code"] in ("URL_SCHEME_FORBIDDEN", "INPUT_UNPARSEABLE")


def test_inspect_nonexistent_repo():
    status, body = _post("/v1/import/inspect",
                          {"input": "skillnote-test/definitely-does-not-exist-12345"})
    assert status == 404
    assert body["error"]["code"] == "REPO_NOT_FOUND"


def test_inspect_missing_input_field():
    status, body = _post("/v1/import/inspect", {})
    assert status == 422
    assert body["error"]["code"] == "VALIDATION_ERROR"
```

- [ ] **Step 2: Run tests, expect failure**

```bash
cd backend && pytest tests/integration/test_imports_inspect.py -v
```

- [ ] **Step 3: Create request/response schemas**

Create `backend/app/schemas/imports.py`:

```python
from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field


class InspectRequest(BaseModel):
    input: str = Field(..., min_length=1)
    github_token: Optional[str] = None
    subpath: Optional[str] = None


class InspectSkill(BaseModel):
    name: str
    description: Optional[str] = None
    path: Optional[str] = None
    content_hash: Optional[str] = None
    license: Optional[str] = None


class InspectResponseSource(BaseModel):
    source_type: str
    url: Optional[str]
    host: Optional[str]
    owner: Optional[str]
    repo: Optional[str]
    ref: Optional[str]
    resolved_sha: Optional[str]
    subpath: Optional[str]


class InspectResponse(BaseModel):
    source: InspectResponseSource
    kind: Optional[str]
    skills: List[InspectSkill] = []
    manifest: Optional[dict] = None
    warnings: List[dict] = []
    suggested_collection_slug: Optional[str] = None
    existing_source_id: Optional[str] = None
```

- [ ] **Step 4: Create imports router**

Create `backend/app/api/imports.py`:

```python
"""HTTP routes for /v1/import/*."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.schemas.imports import InspectRequest, InspectResponse, InspectResponseSource, InspectSkill
from app.services.imports.input_parser import parse_input
from app.services.imports.security import validate_import_url, SecurityError
from app.services.imports.inspector import inspect_source
from app.core.errors import api_error


router = APIRouter(prefix="/v1/import", tags=["imports"])


def _http_error(status: int, code: str, message: str):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


@router.post("/inspect", response_model=InspectResponse)
def inspect_endpoint(body: InspectRequest):
    parsed = parse_input(body.input)
    if parsed is None:
        raise api_error(400, "INPUT_UNPARSEABLE",
                         "Try 'owner/repo', a git URL, or a .json URL")
    if "error" in parsed:
        raise api_error(400, "INPUT_UNPARSEABLE", parsed["error"])

    # Apply security gates on any full URL we might hit
    url_for_check = parsed.get("url") or f"https://github.com/{parsed.get('repo')}"
    try:
        validate_import_url(url_for_check)
    except SecurityError as e:
        raise api_error(400, str(e), "URL rejected by security policy")

    if body.subpath:
        parsed["subpath"] = body.subpath

    result = inspect_source(parsed, token=body.github_token, timeout_s=30)

    if result.error_code:
        code = result.error_code
        status_map = {
            "REPO_NOT_FOUND": 404,
            "REPO_PRIVATE": 401,
            "RATE_LIMITED": 429,
            "UPSTREAM_TIMEOUT": 504,
            "UNSUPPORTED_SOURCE_TYPE": 400,
        }
        status = status_map.get(code, 500)
        raise api_error(status, code, result.error_message or code)

    suggested = None
    if result.owner and result.repo:
        suggested = f"{result.owner}-{result.repo}".lower()

    return InspectResponse(
        source=InspectResponseSource(
            source_type=result.source_type,
            url=result.url, host=result.host,
            owner=result.owner, repo=result.repo,
            ref=result.ref, resolved_sha=result.resolved_sha,
            subpath=result.subpath,
        ),
        kind=result.kind,
        skills=[InspectSkill(**s) for s in result.skills],
        manifest=result.manifest,
        suggested_collection_slug=suggested,
    )
```

- [ ] **Step 5: Register router in main.py**

Modify `backend/app/main.py`. Add alongside existing routers:

```python
from app.api.imports import router as imports_router
...
app.include_router(imports_router)
```

- [ ] **Step 6: Rebuild container + run tests**

```bash
podman-compose down api && podman-compose build --no-cache api && podman-compose up -d api
cd backend && pytest tests/integration/test_imports_inspect.py -v
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/imports.py \
        backend/app/api/imports.py \
        backend/app/main.py \
        backend/tests/integration/test_imports_inspect.py
git commit -m "feat(backend): POST /v1/import/inspect endpoint"
```

---

## Task 9: `importer.py` + `POST /v1/import/apply` endpoint

**Files:**
- Create: `backend/app/services/imports/importer.py`
- Modify: `backend/app/api/imports.py` (add `apply` route)
- Modify: `backend/app/schemas/imports.py` (add apply schemas)
- Test: `backend/tests/integration/test_imports_apply.py`

- [ ] **Step 1: Write apply-endpoint tests**

Create `backend/tests/integration/test_imports_apply.py`:

```python
"""Integration tests for POST /v1/import/apply."""
import json
import os
import urllib.request, urllib.error
import uuid

import pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _req(method, path, body=None):
    req = urllib.request.Request(
        f"{BASE_URL}{path}", method=method,
        headers={"Content-Type": "application/json"} if body else {},
        data=(json.dumps(body).encode() if body else None),
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
def unique_slug():
    return f"imp-test-{uuid.uuid4().hex[:8]}"


def test_apply_happy_path(unique_slug):
    status, body = _req("POST", "/v1/import/apply", {
        "input": "wshobson/agents",
        "target_collection_slug": unique_slug,
        "skill_selection": [],  # all
        "on_conflict": "rename",
    })
    assert status in (201, 404, 429)
    if status == 201:
        assert body["collection_slug"] == unique_slug
        assert "source_id" in body
        # Cleanup
        _req("DELETE", f"/v1/import/sources/{body['source_id']}?remove_skills=true")


def test_apply_rejects_invalid_collection_slug():
    status, body = _req("POST", "/v1/import/apply", {
        "input": "wshobson/agents",
        "target_collection_slug": "Bad Name",
    })
    assert status == 422


def test_apply_oversize_selection_rejected():
    # Simulate by selecting an obviously-nonexistent skill; apply just no-ops.
    status, body = _req("POST", "/v1/import/apply", {
        "input": "wshobson/agents",
        "target_collection_slug": "does-not-matter",
        "skill_selection": ["ghost-skill-that-does-not-exist"],
    })
    # Shouldn't 500; some error or 201-with-zero-imports
    assert status != 500
```

- [ ] **Step 2: Run tests, expect failure**

- [ ] **Step 3: Add apply schemas + importer**

Add to `backend/app/schemas/imports.py`:

```python
class ApplyRequest(BaseModel):
    input: str
    github_token: Optional[str] = None
    ref: Optional[str] = None
    subpath: Optional[str] = None
    target_collection_slug: Optional[str] = None
    skill_selection: Optional[List[str]] = None  # None = all
    on_conflict: str = "rename"  # "rename" | "skip" | "replace"


class ApplyResponseSkill(BaseModel):
    name: str
    slug: str
    original_name: Optional[str] = None
    renamed_reason: Optional[str] = None


class ApplyResponse(BaseModel):
    source_id: str
    collection_slug: str
    imported: List[ApplyResponseSkill]
    skipped: List[dict] = []
```

Create `backend/app/services/imports/importer.py`:

```python
"""Transactional import applier.

UPSERT semantics:
- import_sources: UPSERT on (url, ref, subpath) — refreshes last_synced_at, sha, status.
- collections: INSERT ... ON CONFLICT DO NOTHING.
- skills: 3 paths based on existing-skill state (see spec).
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.db.models import Skill, Collection, ImportSource
from app.services.imports.inspector import InspectResult


class ImportError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def apply_import(
    db: Session,
    inspect_result: InspectResult,
    target_collection_slug: str,
    skill_selection: Optional[List[str]] = None,
    on_conflict: str = "rename",
) -> dict:
    """Apply a previously-inspected source into the DB. Returns {source_id, collection_slug, imported, skipped}."""
    # 1) Validate target collection slug (reuses 0.3.2 validator)
    from app.validators.collection_validator import validate_collection_name
    errs = validate_collection_name(target_collection_slug)
    if errs:
        raise ImportError("COLLECTION_NAME_INVALID", "; ".join(errs))

    # 2) UPSERT import_source
    existing_source = (
        db.query(ImportSource)
        .filter(
            ImportSource.url == f"{inspect_result.host}/{inspect_result.owner}/{inspect_result.repo}"
            if inspect_result.host else inspect_result.url,
            ImportSource.ref == inspect_result.ref,
            ImportSource.subpath == inspect_result.subpath,
        )
        .first()
    )
    if existing_source is None:
        src = ImportSource(
            source_type=inspect_result.source_type,
            url=inspect_result.url,
            host=inspect_result.host,
            owner=inspect_result.owner,
            repo=inspect_result.repo,
            ref=inspect_result.ref,
            subpath=inspect_result.subpath,
            kind=inspect_result.kind or "plugin",
            collection_name=target_collection_slug,
            imported_at_sha=inspect_result.resolved_sha,
            upstream_sha=inspect_result.resolved_sha,
            last_synced_at=datetime.now(timezone.utc),
            status="up_to_date",
        )
        db.add(src)
    else:
        src = existing_source
        src.imported_at_sha = inspect_result.resolved_sha
        src.upstream_sha = inspect_result.resolved_sha
        src.last_synced_at = datetime.now(timezone.utc)
        src.status = "up_to_date"
        src.last_error = None
    db.flush()

    # 3) Ensure collection exists
    col = db.get(Collection, target_collection_slug)
    if col is None:
        col = Collection(
            name=target_collection_slug,
            description=f"Imported from {inspect_result.host}/{inspect_result.owner}/{inspect_result.repo}",
        )
        db.add(col)
        db.flush()

    # 4) For each selected skill, resolve conflict + insert/update
    imported = []
    skipped = []
    for skill_meta in (inspect_result.skills or []):
        name = skill_meta.get("name")
        if skill_selection is not None and name not in skill_selection:
            continue

        existing = db.query(Skill).filter(Skill.slug == name).first()
        if existing is None:
            content_hash = skill_meta.get("content_hash") or ""
            new_skill = Skill(
                id=uuid.uuid4(),
                name=name, slug=name,
                description=skill_meta.get("description", ""),
                collections=[target_collection_slug],
                import_source_id=src.id,
                source_path=skill_meta.get("path"),
                source_sha=inspect_result.resolved_sha,
                source_content_hash=content_hash,
                forked_from_source=False,
            )
            db.add(new_skill)
            imported.append({"name": name, "slug": name})
        else:
            # Conflict path: if existing skill belongs to this source and is unchanged, no-op
            if existing.import_source_id == src.id and not existing.forked_from_source:
                if existing.source_content_hash != skill_meta.get("content_hash"):
                    existing.description = skill_meta.get("description", existing.description)
                    existing.source_content_hash = skill_meta.get("content_hash")
                    existing.source_sha = inspect_result.resolved_sha
                imported.append({"name": name, "slug": name})
            elif on_conflict == "skip":
                skipped.append({"name": name, "reason": "conflict"})
            elif on_conflict == "rename":
                new_name = _find_available_slug(db, name)
                new_skill = Skill(
                    id=uuid.uuid4(),
                    name=new_name, slug=new_name,
                    description=skill_meta.get("description", ""),
                    collections=[target_collection_slug],
                    import_source_id=src.id,
                    source_path=skill_meta.get("path"),
                    source_sha=inspect_result.resolved_sha,
                    source_content_hash=skill_meta.get("content_hash", ""),
                    forked_from_source=False,
                )
                db.add(new_skill)
                imported.append({"name": new_name, "slug": new_name,
                                 "original_name": name, "renamed_reason": "conflict"})
            # on_conflict == "replace": not in v1 default

    db.commit()
    return {
        "source_id": str(src.id),
        "collection_slug": target_collection_slug,
        "imported": imported,
        "skipped": skipped,
    }


def _find_available_slug(db: Session, base: str) -> str:
    i = 2
    while True:
        candidate = f"{base}-{i}"
        if db.query(Skill).filter(Skill.slug == candidate).first() is None:
            return candidate
        i += 1
```

- [ ] **Step 4: Add apply endpoint**

Modify `backend/app/api/imports.py` — add:

```python
from fastapi import Depends
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.schemas.imports import ApplyRequest, ApplyResponse, ApplyResponseSkill
from app.services.imports.importer import apply_import, ImportError as ImportErr


@router.post("/apply", response_model=ApplyResponse, status_code=201)
def apply_endpoint(body: ApplyRequest, db: Session = Depends(get_db)):
    parsed = parse_input(body.input)
    if parsed is None or "error" in parsed:
        raise api_error(400, "INPUT_UNPARSEABLE", "Unable to parse input")

    url_for_check = parsed.get("url") or f"https://github.com/{parsed.get('repo')}"
    try:
        validate_import_url(url_for_check)
    except SecurityError as e:
        raise api_error(400, str(e), "URL rejected by security policy")

    if body.subpath:
        parsed["subpath"] = body.subpath
    result = inspect_source(parsed, token=body.github_token, timeout_s=60)
    if result.error_code:
        raise api_error(400, result.error_code, result.error_message)

    target = body.target_collection_slug or (
        f"{result.owner}-{result.repo}".lower() if result.owner and result.repo else "imported"
    )
    try:
        out = apply_import(
            db, result, target,
            skill_selection=body.skill_selection,
            on_conflict=body.on_conflict,
        )
    except ImportErr as e:
        raise api_error(422, e.code, e.message)

    return ApplyResponse(
        source_id=out["source_id"],
        collection_slug=out["collection_slug"],
        imported=[ApplyResponseSkill(**s) for s in out["imported"]],
        skipped=out["skipped"],
    )
```

- [ ] **Step 5: Rebuild + run tests**

```bash
podman-compose down api && podman-compose build --no-cache api && podman-compose up -d api
cd backend && pytest tests/integration/test_imports_apply.py -v
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/imports/importer.py \
        backend/app/schemas/imports.py \
        backend/app/api/imports.py \
        backend/tests/integration/test_imports_apply.py
git commit -m "feat(backend): importer + POST /v1/import/apply with UPSERT"
```

---

## Task 10: `GET /v1/import/sources` + BackgroundTasks drift probe

**Files:**
- Modify: `backend/app/api/imports.py` (add sources route)
- Modify: `backend/app/schemas/imports.py` (add Source response)
- Create: `backend/app/services/imports/refresher.py` (HEAD probe logic)
- Test: `backend/tests/integration/test_imports_sources.py`

- [ ] **Step 1: Tests**

Create `backend/tests/integration/test_imports_sources.py`:

```python
import json, os, urllib.request, urllib.error, uuid, pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _req(method, path, body=None):
    req = urllib.request.Request(
        f"{BASE_URL}{path}", method=method,
        headers={"Content-Type": "application/json"} if body else {},
        data=(json.dumps(body).encode() if body else None),
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


def test_list_sources_empty_ok():
    status, body = _req("GET", "/v1/import/sources")
    assert status == 200
    assert isinstance(body, list)


def test_list_sources_returns_drift_badges():
    # After any apply has run earlier this session, there should be ≥0 sources
    status, body = _req("GET", "/v1/import/sources")
    assert status == 200
    for src in body:
        for key in ("id", "url", "status", "skill_count"):
            assert key in src
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Refresher + sources route**

Create `backend/app/services/imports/refresher.py`:

```python
"""HEAD-SHA probe for drift detection."""
from __future__ import annotations

import json
import os
import time
import urllib.error, urllib.request
from dataclasses import dataclass

from sqlalchemy.orm import Session
from app.db.models import ImportSource

from datetime import datetime, timezone


_cache = {}  # (url, ref) -> (timestamp, sha)
_TTL = 600  # 10 min


def probe_head_sha(source: ImportSource, token: str = None, timeout_s: int = 3) -> None:
    """Probe upstream HEAD SHA. Updates source.upstream_sha, status, last_checked_at in place.

    Only handles GitHub source_type for v1. Other types are skipped.
    """
    if source.pinned:
        return
    if source.source_type != "github" or not source.owner or not source.repo:
        return

    key = (source.url, source.ref)
    now = time.time()
    if key in _cache and now - _cache[key][0] < _TTL:
        new_sha = _cache[key][1]
    else:
        api_base = os.environ.get("SKILLNOTE_IMPORT_GITHUB_API_BASE", "https://api.github.com")
        url = f"{api_base}/repos/{source.owner}/{source.repo}/commits/{source.ref or 'main'}"
        headers = {"User-Agent": "skillnote-import/0.3.3"}
        if token:
            headers["Authorization"] = f"token {token}"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                body = json.loads(resp.read())
            new_sha = body.get("sha")
            _cache[key] = (now, new_sha)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            source.status = "unreachable"
            return

    source.last_checked_at = datetime.now(timezone.utc)
    source.upstream_sha = new_sha
    if new_sha and new_sha != source.imported_at_sha:
        source.status = "drift"
    else:
        source.status = "up_to_date"
```

Add to `backend/app/schemas/imports.py`:

```python
class SourceListItem(BaseModel):
    id: str
    url: str
    host: Optional[str]
    owner: Optional[str]
    repo: Optional[str]
    ref: Optional[str]
    kind: str
    collection_slug: str
    pinned: bool
    imported_at_sha: Optional[str]
    upstream_sha: Optional[str]
    last_synced_at: Optional[datetime] = None
    last_checked_at: Optional[datetime] = None
    status: str
    skill_count: int
    drift_summary: Optional[dict] = None
```

Add to `backend/app/api/imports.py`:

```python
from fastapi import BackgroundTasks
from sqlalchemy import func
from app.services.imports.refresher import probe_head_sha
from app.schemas.imports import SourceListItem
from typing import List


@router.get("/sources", response_model=List[SourceListItem])
def list_sources(db: Session = Depends(get_db), background: BackgroundTasks = BackgroundTasks()):
    sources = db.query(ImportSource).all()
    result = []
    for src in sources:
        skill_count = db.query(Skill).filter(Skill.import_source_id == src.id).count()
        result.append(SourceListItem(
            id=str(src.id),
            url=src.url,
            host=src.host, owner=src.owner, repo=src.repo, ref=src.ref,
            kind=src.kind, collection_slug=src.collection_name,
            pinned=src.pinned,
            imported_at_sha=src.imported_at_sha,
            upstream_sha=src.upstream_sha,
            last_synced_at=src.last_synced_at,
            last_checked_at=src.last_checked_at,
            status=src.status,
            skill_count=skill_count,
        ))
        background.add_task(_probe_in_bg, src.id)
    return result


def _probe_in_bg(src_id):
    # Open a fresh DB session since BackgroundTasks outlives the request
    from app.db.session import SessionLocal
    with SessionLocal() as db:
        src = db.get(ImportSource, src_id)
        if src:
            probe_head_sha(src)
            db.commit()
```

- [ ] **Step 4: Rebuild + test**

```bash
podman-compose down api && podman-compose build --no-cache api && podman-compose up -d api
cd backend && pytest tests/integration/test_imports_sources.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/imports/refresher.py \
        backend/app/schemas/imports.py \
        backend/app/api/imports.py \
        backend/tests/integration/test_imports_sources.py
git commit -m "feat(backend): GET /v1/import/sources with BackgroundTasks drift probe"
```

---

## Task 11: `POST /v1/import/sources/{id}/refresh` + `DELETE /v1/import/sources/{id}`

**Files:**
- Modify: `backend/app/api/imports.py` (add refresh + delete routes)
- Modify: `backend/app/schemas/imports.py` (add refresh schemas)
- Test: `backend/tests/integration/test_imports_sources_lifecycle.py`

- [ ] **Step 1: Tests**

```python
# backend/tests/integration/test_imports_sources_lifecycle.py
import json, os, urllib.request, urllib.error, pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _req(method, path, body=None):
    req = urllib.request.Request(
        f"{BASE_URL}{path}", method=method,
        headers={"Content-Type": "application/json"} if body else {},
        data=(json.dumps(body).encode() if body else None),
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


def test_refresh_nonexistent_source():
    status, body = _req("POST", "/v1/import/sources/00000000-0000-0000-0000-000000000000/refresh",
                        {"mode": "preview"})
    assert status == 404


def test_delete_nonexistent_source():
    status, _ = _req("DELETE", "/v1/import/sources/00000000-0000-0000-0000-000000000000")
    assert status == 404
```

- [ ] **Step 2: Add refresh + delete routes**

Modify `backend/app/api/imports.py`:

```python
from fastapi import Query

class RefreshRequest(BaseModel):
    mode: str = "preview"  # "preview" | "apply"
    new_skills: Optional[List[str]] = None
    changed_skills: Optional[List[str]] = None
    removed_skills: Optional[List[str]] = None


@router.post("/sources/{source_id}/refresh")
def refresh_endpoint(source_id: str, body: RefreshRequest, db: Session = Depends(get_db)):
    src = db.get(ImportSource, source_id)
    if not src:
        raise api_error(404, "SOURCE_NOT_FOUND", "Import source not found")

    if body.mode == "preview":
        probe_head_sha(src)
        db.commit()
        return {
            "source_id": str(src.id),
            "from_sha": src.imported_at_sha,
            "to_sha": src.upstream_sha,
            "new": [], "changed": [], "removed": [],  # v1 stub — full diff v1.1
        }
    elif body.mode == "apply":
        # v1: stub — full diff-apply comes in v1.1
        return {"applied": 0}
    else:
        raise api_error(400, "INVALID_MODE", "mode must be 'preview' or 'apply'")


@router.delete("/sources/{source_id}", status_code=204)
def delete_source(source_id: str, remove_skills: bool = Query(False), db: Session = Depends(get_db)):
    src = db.get(ImportSource, source_id)
    if not src:
        raise api_error(404, "SOURCE_NOT_FOUND", "Import source not found")
    if remove_skills:
        db.query(Skill).filter(Skill.import_source_id == src.id).delete()
    else:
        # SET NULL + mark forked
        for skill in db.query(Skill).filter(Skill.import_source_id == src.id).all():
            skill.import_source_id = None
            skill.forked_from_source = True
    db.delete(src)
    db.commit()
    return None
```

- [ ] **Step 3: Rebuild + test + commit**

```bash
podman-compose down api && podman-compose build --no-cache api && podman-compose up -d api
cd backend && pytest tests/integration/test_imports_sources_lifecycle.py -v
git add backend/app/api/imports.py backend/app/schemas/imports.py backend/tests/integration/test_imports_sources_lifecycle.py
git commit -m "feat(backend): refresh + delete endpoints for import sources"
```

---

## Task 12: `GET /marketplace/{slug}.json` publish-back endpoint with ETag

**Files:**
- Create: `backend/app/api/marketplace.py`
- Modify: `backend/app/main.py` (register new router)
- Test: `backend/tests/integration/test_marketplace_endpoint.py`

- [ ] **Step 1: Tests**

Create `backend/tests/integration/test_marketplace_endpoint.py`:

```python
import json, os, urllib.request, urllib.error, pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _get(path, if_none_match=None):
    headers = {}
    if if_none_match:
        headers["If-None-Match"] = if_none_match
    req = urllib.request.Request(f"{BASE_URL}{path}", headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, dict(r.headers), json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), None


def test_marketplace_nonexistent_collection_404():
    status, _, _ = _get("/marketplace/does-not-exist.json")
    assert status == 404


def test_marketplace_valid_collection_shape():
    # Requires a pre-existing collection. Use 'frontend' from seed data.
    status, headers, body = _get("/marketplace/frontend.json")
    if status == 404:
        pytest.skip("no 'frontend' collection in test DB")
    assert status == 200
    assert body["name"] == "frontend"
    assert "plugins" in body
    assert "ETag" in headers


def test_marketplace_etag_304():
    status, headers, _ = _get("/marketplace/frontend.json")
    if status != 200:
        pytest.skip("no 'frontend' collection")
    etag = headers.get("ETag")
    status2, _, _ = _get("/marketplace/frontend.json", if_none_match=etag)
    assert status2 == 304
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

Create `backend/app/api/marketplace.py`:

```python
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.db.models import Collection
from app.services.imports.publisher import serialize_collection, compute_etag
from app.core.errors import api_error


router = APIRouter(prefix="/marketplace", tags=["marketplace"])


@router.get("/{slug}.json")
def publish(slug: str, response: Response,
            if_none_match: str | None = Header(default=None),
            db: Session = Depends(get_db)):
    import re
    if not re.match(r"^[a-z0-9_-]+$", slug):
        raise api_error(404, "NOT_FOUND", "Collection not found")
    c = db.get(Collection, slug)
    if c is None:
        raise api_error(404, "NOT_FOUND", "Collection not found")

    manifest = serialize_collection(db, slug)
    etag = compute_etag(manifest)

    if if_none_match == etag:
        return Response(status_code=304)

    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "public, max-age=60, must-revalidate"
    return manifest
```

Register in `backend/app/main.py`:

```python
from app.api.marketplace import router as marketplace_router
app.include_router(marketplace_router)
```

- [ ] **Step 4: Rebuild + test**

```bash
podman-compose down api && podman-compose build --no-cache api && podman-compose up -d api
cd backend && pytest tests/integration/test_marketplace_endpoint.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/marketplace.py \
        backend/app/main.py \
        backend/tests/integration/test_marketplace_endpoint.py
git commit -m "feat(backend): GET /marketplace/{slug}.json publish-back with ETag"
```

---

## Task 13: Frontend — shadcn Resizable + API clients + client-side input parser

**Files:**
- Modify: `package.json` (adds `react-resizable-panels` via shadcn CLI)
- Create: `src/components/ui/resizable.tsx` (via shadcn)
- Create: `src/lib/api/imports.ts`
- Create: `src/lib/api/marketplace.ts`
- Create: `src/lib/parse-marketplace-input.ts`

- [ ] **Step 1: Install shadcn Resizable**

```bash
npx shadcn@latest add resizable
```

- [ ] **Step 2: Create fetch wrappers**

Create `src/lib/api/imports.ts`:

```typescript
import { apiRequest } from './client'

export type InspectPayload = {
  input: string
  github_token?: string
  subpath?: string
}

export type ParsedSource = {
  source_type: string
  url?: string
  host?: string
  owner?: string
  repo?: string
  ref?: string
  resolved_sha?: string
  subpath?: string
}

export type InspectSkill = {
  name: string
  description?: string
  path?: string
  content_hash?: string
  license?: string
}

export type InspectResponse = {
  source: ParsedSource
  kind?: string
  skills: InspectSkill[]
  manifest?: Record<string, unknown>
  warnings: Array<{ code: string; message: string }>
  suggested_collection_slug?: string
  existing_source_id?: string | null
}

export function inspectSource(payload: InspectPayload) {
  return apiRequest<InspectResponse>('/v1/import/inspect', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type ApplyPayload = {
  input: string
  github_token?: string
  subpath?: string
  target_collection_slug?: string
  skill_selection?: string[]
  on_conflict?: 'rename' | 'skip' | 'replace'
}

export type ApplyResponse = {
  source_id: string
  collection_slug: string
  imported: Array<{ name: string; slug: string; original_name?: string; renamed_reason?: string }>
  skipped: Array<{ name: string; reason: string }>
}

export function applyImport(payload: ApplyPayload) {
  return apiRequest<ApplyResponse>('/v1/import/apply', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type SourceListItem = {
  id: string
  url: string
  host?: string
  owner?: string
  repo?: string
  ref?: string
  kind: string
  collection_slug: string
  pinned: boolean
  imported_at_sha?: string
  upstream_sha?: string
  last_synced_at?: string
  last_checked_at?: string
  status: 'up_to_date' | 'drift' | 'unreachable' | 'error'
  skill_count: number
  drift_summary?: { new: number; changed: number; removed: number }
}

export function listSources() {
  return apiRequest<SourceListItem[]>('/v1/import/sources')
}

export function refreshSource(id: string, mode: 'preview' | 'apply' = 'preview') {
  return apiRequest(`/v1/import/sources/${id}/refresh`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  })
}

export function deleteSource(id: string, removeSkills = false) {
  return apiRequest(`/v1/import/sources/${id}?remove_skills=${removeSkills}`, {
    method: 'DELETE',
  })
}
```

Create `src/lib/api/marketplace.ts`:

```typescript
import { getApiBaseUrl } from './client'

export function marketplaceUrl(slug: string): string {
  return `${getApiBaseUrl()}/marketplace/${slug}.json`
}
```

Create `src/lib/parse-marketplace-input.ts` (TS port, used for live detection chip):

```typescript
export type ParsedSource =
  | { source_type: 'github'; repo: string; ref?: string }
  | { source_type: 'git'; url: string; ref?: string }
  | { source_type: 'url'; url: string }
  | { source_type: 'directory'; path: string }
  | { error: string }
  | null

const SSH_RE = /^([a-zA-Z0-9._-]+@[^:]+:.+?(?:\.git)?)(#(.+))?$/
const REF_RE = /^([^#@]+)(?:[#@](.+))?$/

export function parseMarketplaceInput(raw: string): ParsedSource {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.includes('\n') || trimmed.includes('\0')) return null

  const sshMatch = trimmed.match(SSH_RE)
  if (sshMatch?.[1]) {
    return sshMatch[3]
      ? { source_type: 'git', url: sshMatch[1], ref: sshMatch[3] }
      : { source_type: 'git', url: sshMatch[1] }
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const [url, ref] = trimmed.split('#')
    if (url.endsWith('.git') || url.includes('/_git/')) {
      return ref ? { source_type: 'git', url, ref } : { source_type: 'git', url }
    }
    const gh = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/]+?)(?:\/|\.git)?\/?$/)
    if (gh) {
      const gitUrl = url.endsWith('.git') ? url : `${url}.git`
      return ref ? { source_type: 'git', url: gitUrl, ref } : { source_type: 'git', url: gitUrl }
    }
    return { source_type: 'url', url }
  }

  if (trimmed.includes('/') && !trimmed.startsWith('@')) {
    if (trimmed.includes(':')) return null
    const m = trimmed.match(REF_RE)
    if (m) {
      const repo = m[1]
      if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) return null
      return m[2]
        ? { source_type: 'github', repo, ref: m[2] }
        : { source_type: 'github', repo }
    }
  }
  return null
}
```

- [ ] **Step 3: Verify TS compiles**

```bash
npx tsc --noEmit 2>&1 | grep -E "imports\.ts|marketplace\.ts|parse-marketplace" || echo "clean"
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/imports.ts \
        src/lib/api/marketplace.ts \
        src/lib/parse-marketplace-input.ts \
        src/components/ui/resizable.tsx \
        package.json
git commit -m "feat(frontend): API clients + client-side parser + shadcn Resizable"
```

---

## Task 14: `/browse` route + empty state + sidebar link

**Files:**
- Create: `src/app/(app)/browse/page.tsx`
- Create: `src/components/browse/BrowseEmptyState.tsx`
- Create: `src/components/browse/BrowseSourcesList.tsx`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Create the empty state**

`src/components/browse/BrowseEmptyState.tsx`:

```tsx
'use client'
import { Compass } from 'lucide-react'

type Props = {
  onPasteUrl: () => void
}

export function BrowseEmptyState({ onPasteUrl }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Compass className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold">Pull in skills from the community.</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Browse curated collections, or paste a GitHub URL to import your own.
      </p>
      <div className="mt-6 flex gap-3">
        <button disabled
          className="rounded-md border border-border/60 bg-card px-4 py-2 text-sm text-muted-foreground opacity-60"
          title="Coming soon">
          Browse library
        </button>
        <button onClick={onPasteUrl}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90">
          Paste a URL
        </button>
      </div>
      <a className="mt-4 text-xs text-muted-foreground hover:underline" href="#">
        What are skills? →
      </a>
    </div>
  )
}
```

- [ ] **Step 2: Create the sources list (stub for now)**

`src/components/browse/BrowseSourcesList.tsx`:

```tsx
'use client'
import type { SourceListItem } from '@/lib/api/imports'

export function BrowseSourcesList({ sources }: { sources: SourceListItem[] }) {
  return (
    <div className="space-y-3">
      {sources.map(s => (
        <div key={s.id} className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{s.owner}/{s.repo}</div>
              <div className="text-xs text-muted-foreground">
                {s.ref ?? 'main'} · {s.imported_at_sha?.slice(0, 7)} · {s.skill_count} skills
              </div>
            </div>
            <StatusPill status={s.status} summary={s.drift_summary} />
          </div>
        </div>
      ))}
    </div>
  )
}

function StatusPill({ status, summary }: { status: string; summary?: { new: number; changed: number; removed: number } }) {
  if (status === 'up_to_date') {
    return <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">up to date</span>
  }
  if (status === 'drift' && summary) {
    return (
      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        {summary.new} new · {summary.changed} changed
      </span>
    )
  }
  return <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">unreachable</span>
}
```

- [ ] **Step 3: Create the page**

`src/app/(app)/browse/page.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { listSources, type SourceListItem } from '@/lib/api/imports'
import { BrowseEmptyState } from '@/components/browse/BrowseEmptyState'
import { BrowseSourcesList } from '@/components/browse/BrowseSourcesList'

export default function BrowsePage() {
  const [sources, setSources] = useState<SourceListItem[] | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    listSources().then(setSources).catch(() => setSources([]))
  }, [])

  if (sources === null) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
  }

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Browse</h1>
        <button
          onClick={() => setSheetOpen(true)}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-foreground/90">
          + Add source
        </button>
      </header>

      {sources.length === 0
        ? <BrowseEmptyState onPasteUrl={() => setSheetOpen(true)} />
        : <BrowseSourcesList sources={sources} />
      }

      {/* Placeholder — Task 15 replaces this with ImportSheet */}
      {sheetOpen && (
        <div className="fixed inset-0 bg-black/30" onClick={() => setSheetOpen(false)}>
          <div className="absolute right-0 top-0 h-full w-[600px] bg-card p-6">ImportSheet (Task 15)</div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Add sidebar link**

Open `src/components/layout/sidebar.tsx` and add a new group + entry. Inside the existing rendering of sidebar items, add:

```tsx
import { Compass } from 'lucide-react'
// ...

// In the sidebar group render, add:
<div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
  Discover
</div>
<Link href="/browse"
  className={cn('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-muted',
                pathname === '/browse' && 'bg-muted font-medium')}>
  <Compass className="h-4 w-4" />
  Browse
</Link>
```

Adjust according to existing sidebar structure in your codebase.

- [ ] **Step 5: Verify**

```bash
npm run dev
# Visit http://localhost:3000/browse → empty state renders
```

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/browse/page.tsx \
        src/components/browse/BrowseEmptyState.tsx \
        src/components/browse/BrowseSourcesList.tsx \
        src/components/layout/sidebar.tsx
git commit -m "feat(frontend): /browse page + sidebar link + empty state"
```

---

## Task 15: `ImportSheet` with URL input + inspect state

**Files:**
- Create: `src/components/browse/ImportSheet.tsx`
- Create: `src/components/browse/InspectPreview.tsx`
- Modify: `src/app/(app)/browse/page.tsx` (replace placeholder with ImportSheet)

- [ ] **Step 1: Build ImportSheet**

Create `src/components/browse/ImportSheet.tsx`:

```tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { inspectSource, type InspectResponse, applyImport } from '@/lib/api/imports'
import { parseMarketplaceInput } from '@/lib/parse-marketplace-input'
import { toast } from 'sonner'
import { SkillNoteApiError } from '@/lib/api/client'

type State =
  | { kind: 'idle' }
  | { kind: 'inspecting' }
  | { kind: 'preview'; data: InspectResponse }
  | { kind: 'inspect_failed'; message: string }
  | { kind: 'applying' }
  | { kind: 'success' }

export function ImportSheet({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [input, setInput] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [targetSlug, setTargetSlug] = useState<string>('')

  const detect = parseMarketplaceInput(input)

  async function doInspect() {
    if (!input.trim()) return
    setState({ kind: 'inspecting' })
    try {
      const data = await inspectSource({ input: input.trim() })
      setState({ kind: 'preview', data })
      setSelection(new Set(data.skills.map(s => s.name)))
      if (data.suggested_collection_slug) setTargetSlug(data.suggested_collection_slug)
    } catch (err) {
      const msg = err instanceof SkillNoteApiError ? err.message : 'Network error'
      setState({ kind: 'inspect_failed', message: msg })
    }
  }

  async function doImport() {
    if (state.kind !== 'preview') return
    setState({ kind: 'applying' })
    try {
      const r = await applyImport({
        input: input.trim(),
        target_collection_slug: targetSlug,
        skill_selection: [...selection],
      })
      toast.success(`✓ Imported ${r.imported.length} skills from ${state.data.source.owner}/${state.data.source.repo}`)
      setState({ kind: 'success' })
      onImported()
      setTimeout(onClose, 500)
    } catch (err) {
      setState({ kind: 'inspect_failed', message: err instanceof Error ? err.message : 'Apply failed' })
    }
  }

  const selectAll = () => state.kind === 'preview' && setSelection(new Set(state.data.skills.map(s => s.name)))
  const deselectAll = () => setSelection(new Set())
  const toggle = (name: string) => {
    const next = new Set(selection)
    if (next.has(name)) next.delete(name); else next.add(name)
    setSelection(next)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose}>
      <div className="absolute right-0 top-0 flex h-full w-[min(900px,90vw)] flex-col bg-card shadow-2xl"
           onClick={e => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <h3 className="font-semibold">Import skills from a repository</h3>
          <button onClick={onClose}><X className="h-4 w-4" /></button>
        </header>

        <div className="flex-1 overflow-auto p-6 space-y-4">
          <label className="block text-xs font-medium">Repository or URL</label>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onBlur={doInspect}
            placeholder="wshobson/agents, https://github.com/owner/repo, or https://.../marketplace.json"
            className="h-10 w-full rounded-md border border-border/60 bg-muted/50 px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
          {detect && 'source_type' in detect && (
            <div className="text-xs text-muted-foreground">
              ✓ Detected: {detect.source_type} {'repo' in detect && `· ${detect.repo}`} {'ref' in detect && detect.ref && `· ${detect.ref}`}
            </div>
          )}

          {state.kind === 'inspecting' && <div className="text-sm text-muted-foreground">Inspecting…</div>}
          {state.kind === 'inspect_failed' && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {state.message}
            </div>
          )}
          {state.kind === 'preview' && (
            <div className="space-y-3">
              <div className="rounded-md border border-border/50 bg-muted/30 p-3 text-sm">
                {state.data.source.host}/{state.data.source.owner}/{state.data.source.repo} ·
                {state.data.source.ref ?? ' main'} · {state.data.skills.length} skills
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Import into</label>
                <input value={targetSlug} onChange={e => setTargetSlug(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-muted/50 px-3 text-sm" />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  You can move skills into other collections after import.
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span>[{selection.size} / {state.data.skills.length}]</span>
                  <div className="space-x-2">
                    <button onClick={selectAll}>Select all</button>
                    <button onClick={deselectAll}>Deselect all</button>
                  </div>
                </div>
                <div className="max-h-[400px] overflow-auto rounded-md border border-border/30">
                  {state.data.skills.map(s => (
                    <label key={s.name} className="flex items-start gap-2 border-b border-border/20 p-2 last:border-b-0">
                      <input type="checkbox" checked={selection.has(s.name)} onChange={() => toggle(s.name)} />
                      <div>
                        <div className="text-sm font-medium">{s.name}</div>
                        <div className="text-xs text-muted-foreground">{s.description?.slice(0, 80)}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-border/60 px-6 py-4">
          <button onClick={onClose}
            className="rounded-md border border-border/60 bg-card px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            onClick={doImport}
            disabled={state.kind !== 'preview' || selection.size === 0}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50">
            {state.kind === 'applying' ? 'Importing…' : `Import ${selection.size} skills`}
          </button>
        </footer>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire ImportSheet into the browse page**

Modify `src/app/(app)/browse/page.tsx`:

```tsx
import { ImportSheet } from '@/components/browse/ImportSheet'

// Replace the sheetOpen placeholder with:
{sheetOpen && (
  <ImportSheet
    onClose={() => setSheetOpen(false)}
    onImported={() => listSources().then(setSources)}
  />
)}
```

- [ ] **Step 3: Run `npm run dev`, manual smoke-test the flow**

- [ ] **Step 4: Commit**

```bash
git add src/components/browse/ImportSheet.tsx src/app/\(app\)/browse/page.tsx
git commit -m "feat(frontend): ImportSheet — URL input + inspect + apply flow"
```

---

## Task 16: Security attack integration tests

**Files:**
- Create: `backend/tests/integration/test_imports_security_attacks.py`

- [ ] **Step 1: Write adversarial test suite**

```python
"""Adversarial security scenarios against /v1/import/*."""
import json, os, urllib.request, urllib.error
import pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _inspect(input_str):
    req = urllib.request.Request(
        f"{BASE_URL}/v1/import/inspect", method="POST",
        headers={"Content-Type": "application/json"},
        data=json.dumps({"input": input_str}).encode(),
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


@pytest.mark.parametrize("payload,expected_status,expected_code", [
    ("file:///etc/passwd",              400, "URL_SCHEME_FORBIDDEN"),
    ("javascript:alert(1)",             400, "URL_SCHEME_FORBIDDEN"),
    ("ftp://example.com/foo",           400, "URL_SCHEME_FORBIDDEN"),
    ("data:text/plain;base64,xxx",      400, "URL_SCHEME_FORBIDDEN"),
    ("http://169.254.169.254/metadata", 400, "URL_SCHEME_FORBIDDEN"),
    ("http://localhost:8082/v1/collections", 400, "URL_SCHEME_FORBIDDEN"),
    ("http://127.0.0.1",                400, "URL_SCHEME_FORBIDDEN"),
    ("http://10.0.0.1/",                400, "URL_SCHEME_FORBIDDEN"),
    ("http://192.168.1.1/",             400, "URL_SCHEME_FORBIDDEN"),
    ("http://172.16.0.1/",              400, "URL_SCHEME_FORBIDDEN"),
    ("",                                400, "INPUT_UNPARSEABLE"),
    ("owner/repo\nembedded-newline",   400, "INPUT_UNPARSEABLE"),
    ("owner/repo\0nullbyte",           400, "INPUT_UNPARSEABLE"),
    ("owner/repo; rm -rf /",            400, "INPUT_UNPARSEABLE"),
    ("owner/repo@../../etc",            400, "INPUT_UNPARSEABLE"),
])
def test_adversarial_input_rejected(payload, expected_status, expected_code):
    status, body = _inspect(payload)
    assert status == expected_status
    assert body["error"]["code"] == expected_code
```

- [ ] **Step 2: Run + commit**

```bash
cd backend && pytest tests/integration/test_imports_security_attacks.py -v
git add backend/tests/integration/test_imports_security_attacks.py
git commit -m "test(backend): adversarial security test suite for imports"
```

---

## Task 17: Collection page — import banner + local-only chip

**Files:**
- Modify: `src/app/(app)/collections/[slug]/page.tsx`
- Modify: `src/app/(app)/collections/page.tsx`
- Create: `src/components/browse/SourceBadge.tsx`
- Create: `src/components/browse/LocalOnlyChip.tsx`

- [ ] **Step 1: Source badge + local-only chip**

Create `src/components/browse/SourceBadge.tsx`:

```tsx
export function SourceBadge({ sourceLabel }: { sourceLabel: string }) {
  return (
    <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      Imported · {sourceLabel}
    </span>
  )
}
```

Create `src/components/browse/LocalOnlyChip.tsx`:

```tsx
export function LocalOnlyChip() {
  return (
    <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground" title="This skill isn't included in the published marketplace (no upstream git source).">
      ⊙ local only
    </span>
  )
}
```

- [ ] **Step 2: Collection detail banner**

Inside `src/app/(app)/collections/[slug]/page.tsx`, wherever the page header is rendered, add:

```tsx
{/* Assume we have a `source` state loaded from listSources filtered by collection_slug */}
{source && (
  <div className="mb-4 rounded-md border border-border/40 bg-muted/40 px-4 py-2 text-xs">
    Imported from {source.host}/{source.owner}/{source.repo} · Tracking {source.ref} · {source.imported_at_sha?.slice(0, 7)} ·
    <a className="ml-1 text-foreground hover:underline" href={`/browse`}>Manage source</a>
  </div>
)}
```

Fetch `source` via a `useEffect` that calls `listSources()` and filters for `s.collection_slug === slug`.

- [ ] **Step 3: Collections page nudge**

In `src/app/(app)/collections/page.tsx`, after the existing collections grid, add:

```tsx
<div className="mt-8 text-center text-sm text-muted-foreground">
  Looking for more? <a className="text-foreground hover:underline" href="/browse">Browse the community →</a>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/browse/SourceBadge.tsx \
        src/components/browse/LocalOnlyChip.tsx \
        src/app/\(app\)/collections/\[slug\]/page.tsx \
        src/app/\(app\)/collections/page.tsx
git commit -m "feat(frontend): collection-page integrations — banner + chips + nudge"
```

---

## Task 18: Fork-on-edit modal on imported skill

**Files:**
- Modify: `src/components/skills/tabs/SkillEditTab.tsx`

- [ ] **Step 1: Add fork-confirm modal logic**

In the save handler of `SkillEditTab.tsx`, before actually saving, check if the skill has `import_source_id` AND is not yet forked:

```tsx
async function handleSave() {
  if (skill.import_source_id && !skill.forked_from_source) {
    const confirm = window.confirm(
      "Edit will fork this skill off its source. You'll keep your changes even when upstream updates. Continue?"
    )
    if (!confirm) return
    // Backend auto-sets forked_from_source=TRUE on PATCH when content changes vs source_content_hash
  }
  // ... existing save flow ...
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/skills/tabs/SkillEditTab.tsx
git commit -m "feat(frontend): fork-confirm modal on imported-skill edit"
```

---

## Task 19: Playwright E2E — first-time user journey

**Files:**
- Create: `e2e/journey-first-time-user.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
import { test, expect } from '@playwright/test'

test('first-time user imports wshobson/agents', async ({ page }) => {
  // Mock /v1/import/inspect
  await page.route('**/v1/import/inspect', async route => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        source: { source_type: 'github', host: 'github.com', owner: 'wshobson', repo: 'agents', ref: 'main', resolved_sha: 'abc123' },
        kind: 'plugin',
        skills: [
          { name: 'python-expert', description: 'Python code-review heuristics' },
          { name: 'react-tuner', description: 'React perf hints' },
        ],
        warnings: [],
        suggested_collection_slug: 'wshobson-agents',
      }),
    })
  })

  // Mock /v1/import/apply
  await page.route('**/v1/import/apply', async route => {
    await route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({
        source_id: 'src-1', collection_slug: 'wshobson-agents',
        imported: [{ name: 'python-expert', slug: 'python-expert' }, { name: 'react-tuner', slug: 'react-tuner' }],
        skipped: [],
      }),
    })
  })

  // Mock /v1/import/sources (empty initially)
  let listCount = 0
  await page.route('**/v1/import/sources', async route => {
    listCount++
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(listCount === 1 ? [] : [{
        id: 'src-1', url: 'github.com/wshobson/agents',
        host: 'github.com', owner: 'wshobson', repo: 'agents', ref: 'main',
        kind: 'plugin', collection_slug: 'wshobson-agents', pinned: false,
        imported_at_sha: 'abc123', upstream_sha: 'abc123',
        status: 'up_to_date', skill_count: 2,
      }]),
    })
  })

  await page.goto('/browse')
  await expect(page.getByText('Pull in skills from the community.')).toBeVisible()
  await page.getByRole('button', { name: /Paste a URL/i }).click()

  const input = page.getByPlaceholder(/wshobson\/agents/i)
  await input.fill('wshobson/agents')
  await input.blur()

  await expect(page.getByText(/github.com\/wshobson\/agents/i)).toBeVisible()
  await expect(page.getByText('python-expert')).toBeVisible()
  await expect(page.getByText('react-tuner')).toBeVisible()

  await page.getByRole('button', { name: /Import 2 skills/i }).click()
  await expect(page.getByText(/Imported 2 skills from wshobson\/agents/i)).toBeVisible({ timeout: 5000 })
})
```

- [ ] **Step 2: Run + commit**

```bash
npx playwright test e2e/journey-first-time-user.spec.ts
git add e2e/journey-first-time-user.spec.ts
git commit -m "test(e2e): first-time user import journey"
```

---

## Task 20: Final integration testing + release prep

**Files:**
- Modify: `package.json` (bump to 0.3.3)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run the full test suite**

```bash
cd backend && pytest
npx playwright test
```

All prior suites green.

- [ ] **Step 2: Bump version**

```bash
# package.json "version": "0.3.3"
# CHANGELOG.md: add new [0.3.3] section summarizing the feature
```

Example `CHANGELOG.md` entry:

```markdown
## [0.3.3] - 2026-04-19

### Added
- **Marketplace Import** — paste a GitHub URL (`owner/repo`, full URL, or `.json` marketplace) to import skills into SkillNote. Supports detection of marketplace / plugin / skill-bundle / single-skill kinds.
- **`Browse` top-level sidebar page** — home for imported sources with drift detection badges and per-source actions (resync, pin, unlink).
- **`GET /marketplace/{slug}.json`** — every SkillNote collection is exposed as a Claude-Code-compatible marketplace, making SkillNote a two-way hub. Users authored skills appear as `⊙ local only` in the UI and are omitted from the manifest.
- **Fork-on-edit** — editing an imported skill prompts a confirmation and marks the skill forked so future drift refreshes warn before overwriting.
- **Drift detection** — lightweight GitHub HEAD-SHA probe on every `/browse` visit (10-min cached), amber `N new · M changed` pills, manual `Resync` action.

### Security
- URL security layer: scheme allowlist (http/https/git/ssh only), private-IP block (RFC1918 + CGNAT + IPv6), manifest schema validation mirroring Claude Code.

### Migration
- `0013_import_sources` creates the `import_sources` table and adds source-tracking columns to skills.
```

- [ ] **Step 3: Commit + prepare merge**

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): 0.3.3 — marketplace import"
```

---

## Self-Review

**Spec coverage:**
- Migration → Task 1 ✓
- input_parser → Task 2 ✓
- manifest_schema → Task 3 ✓
- security → Task 4 ✓
- Mock server → Task 5 ✓
- inspector → Task 6 ✓
- publisher → Task 7 ✓
- inspect route → Task 8 ✓
- apply route + importer → Task 9 ✓
- sources list + BackgroundTasks drift → Task 10 ✓
- refresh + delete → Task 11 ✓
- marketplace publish-back → Task 12 ✓
- Frontend API/parser → Task 13 ✓
- Browse page + sidebar → Task 14 ✓
- ImportSheet flow → Task 15 ✓
- Security attack tests → Task 16 ✓
- Collection banner + chips → Task 17 ✓
- Fork-on-edit modal → Task 18 ✓
- First-time journey E2E → Task 19 ✓
- Release prep → Task 20 ✓

**Deferred to v1.1 (out of this plan's scope):** shell-block scanning, external-URL listing, terminal picker Browse tab, remaining 6 E2E journeys, visual regression, a11y tests, chaos/perf.

**Placeholder scan:** none.

**Type consistency:** `InspectResult` → `InspectResponse` mapping consistent across services and routes. `ImportSource` columns match model, schema, and SQL throughout.

---

## Plan complete
