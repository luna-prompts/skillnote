"""Integration tests for the refresh diff computation."""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.db.models import Collection, ImportSource, Skill
from app.services.imports.refresher import compute_diff


DB_URL = os.environ.get(
    "SKILLNOTE_DATABASE_URL",
    "postgresql+psycopg://skillnote:skillnote@localhost:5432/skillnote",
)


@pytest.fixture
def db_session():
    engine = create_engine(DB_URL)
    try:
        with engine.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as exc:
        pytest.skip(f"DB not reachable: {exc}")
    S = sessionmaker(bind=engine)
    with S() as s:
        yield s
        s.rollback()


def test_compute_diff_all_three_categories(db_session):
    """new, changed, removed — all three populated correctly."""
    slug = f"diff-test-{uuid.uuid4().hex[:8]}"
    col = Collection(name=slug, description="t")
    db_session.add(col)
    db_session.commit()

    src = ImportSource(
        source_type="github",
        url=f"github.com/a/b-{uuid.uuid4().hex[:6]}",
        owner="a",
        repo="b",
        ref="main",
        kind="plugin",
        collection_name=slug,
        imported_at_sha="aaa",
    )
    db_session.add(src)
    db_session.commit()

    # Current state: 3 skills (one stays, one becomes "changed", one "removed").
    stays = Skill(
        id=uuid.uuid4(),
        name=f"stays-{slug}",
        slug=f"stays-{slug}",
        description="u",
        collections=[slug],
        import_source_id=src.id,
        source_content_hash="hash-same",
    )
    changes = Skill(
        id=uuid.uuid4(),
        name=f"changes-{slug}",
        slug=f"changes-{slug}",
        description="u",
        collections=[slug],
        import_source_id=src.id,
        source_content_hash="hash-old",
    )
    removed = Skill(
        id=uuid.uuid4(),
        name=f"removed-{slug}",
        slug=f"removed-{slug}",
        description="u",
        collections=[slug],
        import_source_id=src.id,
        source_content_hash="hash-x",
    )
    db_session.add_all([stays, changes, removed])
    db_session.commit()

    upstream = [
        {"name": f"stays-{slug}", "content_hash": "hash-same"},
        {"name": f"changes-{slug}", "content_hash": "hash-new"},
        {"name": f"brand-new-{slug}", "content_hash": "hash-fresh", "description": "new"},
    ]

    diff = compute_diff(src, db_session, upstream)
    assert len(diff["new"]) == 1 and diff["new"][0]["name"] == f"brand-new-{slug}"
    assert len(diff["changed"]) == 1 and diff["changed"][0]["name"] == f"changes-{slug}"
    assert len(diff["removed"]) == 1 and diff["removed"][0]["name"] == f"removed-{slug}"

    # Cleanup
    for s in [stays, changes, removed]:
        db_session.delete(s)
    db_session.delete(src)
    db_session.delete(col)
    db_session.commit()


def test_compute_diff_forked_flag_propagates(db_session):
    """forked_from_source flag is surfaced in changed & removed items."""
    slug = f"diff-fork-{uuid.uuid4().hex[:8]}"
    col = Collection(name=slug, description="t")
    db_session.add(col)
    db_session.commit()

    src = ImportSource(
        source_type="github",
        url=f"github.com/a/fork-{uuid.uuid4().hex[:6]}",
        owner="a",
        repo="fork",
        ref="main",
        kind="plugin",
        collection_name=slug,
        imported_at_sha="aaa",
    )
    db_session.add(src)
    db_session.commit()

    forked_changed = Skill(
        id=uuid.uuid4(),
        name=f"forked-{slug}",
        slug=f"forked-{slug}",
        description="u",
        collections=[slug],
        import_source_id=src.id,
        source_content_hash="hash-old",
        forked_from_source=True,
    )
    forked_removed = Skill(
        id=uuid.uuid4(),
        name=f"gone-{slug}",
        slug=f"gone-{slug}",
        description="u",
        collections=[slug],
        import_source_id=src.id,
        source_content_hash="hash-any",
        forked_from_source=True,
    )
    db_session.add_all([forked_changed, forked_removed])
    db_session.commit()

    upstream = [
        {"name": f"forked-{slug}", "content_hash": "hash-new"},
    ]

    diff = compute_diff(src, db_session, upstream)
    assert len(diff["changed"]) == 1
    assert diff["changed"][0]["forked_from_source"] is True
    assert len(diff["removed"]) == 1
    assert diff["removed"][0]["forked_from_source"] is True

    db_session.delete(forked_changed)
    db_session.delete(forked_removed)
    db_session.delete(src)
    db_session.delete(col)
    db_session.commit()


def test_compute_diff_no_changes_when_hashes_match(db_session):
    """Empty diff when DB and upstream are identical."""
    slug = f"diff-clean-{uuid.uuid4().hex[:8]}"
    col = Collection(name=slug, description="t")
    db_session.add(col)
    db_session.commit()

    src = ImportSource(
        source_type="github",
        url=f"github.com/a/clean-{uuid.uuid4().hex[:6]}",
        owner="a",
        repo="clean",
        ref="main",
        kind="plugin",
        collection_name=slug,
        imported_at_sha="aaa",
    )
    db_session.add(src)
    db_session.commit()

    skill = Skill(
        id=uuid.uuid4(),
        name=f"same-{slug}",
        slug=f"same-{slug}",
        description="u",
        collections=[slug],
        import_source_id=src.id,
        source_content_hash="hash-identical",
    )
    db_session.add(skill)
    db_session.commit()

    upstream = [{"name": f"same-{slug}", "content_hash": "hash-identical"}]
    diff = compute_diff(src, db_session, upstream)
    assert diff == {"new": [], "changed": [], "removed": []}

    db_session.delete(skill)
    db_session.delete(src)
    db_session.delete(col)
    db_session.commit()
