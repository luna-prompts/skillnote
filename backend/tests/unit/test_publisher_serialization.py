"""Tests for publisher — collection → marketplace.json serialization."""
import uuid

import pytest

from app.db.models import Collection, ImportSource, Skill
from app.services.imports.publisher import serialize_collection


@pytest.fixture
def engine():
    import os
    from sqlalchemy import create_engine, text
    url = os.environ.get(
        "SKILLNOTE_DATABASE_URL",
        "postgresql+psycopg://skillnote:skillnote@localhost:5432/skillnote",
    )
    try:
        e = create_engine(url)
        with e.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as exc:
        pytest.skip(f"DB not reachable: {exc}")
    return e


@pytest.fixture
def db_session(engine):
    from sqlalchemy.orm import sessionmaker
    S = sessionmaker(bind=engine)
    with S() as s:
        yield s
        s.rollback()


def _unique_suffix() -> str:
    return uuid.uuid4().hex[:8]


def _cleanup(db_session, coll_names: list[str]) -> None:
    """Defensive cleanup so tests are idempotent."""
    from sqlalchemy import text
    for name in coll_names:
        db_session.execute(
            text("DELETE FROM skills WHERE :n = ANY(collections)"), {"n": name}
        )
        db_session.execute(
            text("DELETE FROM import_sources WHERE collection_name = :n"), {"n": name}
        )
        db_session.execute(
            text("DELETE FROM collections WHERE name = :n"), {"n": name}
        )
    db_session.commit()


def test_serialize_empty_collection(db_session):
    suffix = _unique_suffix()
    coll_name = f"pub-empty-{suffix}"
    _cleanup(db_session, [coll_name])
    try:
        c = Collection(name=coll_name, description="")
        db_session.add(c)
        db_session.commit()

        result = serialize_collection(db_session, coll_name)
        assert result["name"] == coll_name
        assert result["plugins"] == []
    finally:
        _cleanup(db_session, [coll_name])


def test_serialize_imported_skills_only(db_session):
    suffix = _unique_suffix()
    coll_name = f"pub-test-{suffix}"
    _cleanup(db_session, [coll_name])
    try:
        c = Collection(name=coll_name, description="test")
        db_session.add(c)
        db_session.commit()

        src = ImportSource(
            source_type="github",
            url=f"github.com/a/b-{suffix}",
            host="github.com",
            owner="a",
            repo=f"b-{suffix}",
            ref="main",
            kind="plugin",
            collection_name=coll_name,
            imported_at_sha="abc1234",
        )
        db_session.add(src)
        db_session.commit()

        imported = Skill(
            id=uuid.uuid4(),
            name=f"imp-skill-{suffix}",
            slug=f"imp-skill-{suffix}",
            description="imported",
            collections=[coll_name],
            import_source_id=src.id,
            source_path="skills/imp-skill",
            source_sha="abc1234",
            source_content_hash="hash123",
            forked_from_source=False,
        )
        user_authored = Skill(
            id=uuid.uuid4(),
            name=f"local-skill-{suffix}",
            slug=f"local-skill-{suffix}",
            description="user-created",
            collections=[coll_name],
        )
        db_session.add_all([imported, user_authored])
        db_session.commit()

        result = serialize_collection(db_session, coll_name)
        # Only imported skills appear in plugins
        assert len(result["plugins"]) == 1
        assert result["plugins"][0]["name"] == f"imp-skill-{suffix}"
        assert result["plugins"][0]["source"]["source"] == "git-subdir"
        assert result["plugins"][0]["source"]["url"] == f"https://github.com/a/b-{suffix}"
        assert result["plugins"][0]["source"]["path"] == "skills/imp-skill"
        assert result["plugins"][0]["source"]["ref"] == "main"
        assert result["plugins"][0]["source"]["sha"] == "abc1234"
    finally:
        _cleanup(db_session, [coll_name])


def test_etag_changes_on_content_change():
    from app.services.imports.publisher import compute_etag
    manifest_v1 = {"name": "x", "plugins": []}
    manifest_v2 = {"name": "x", "plugins": [{"name": "y"}]}
    assert compute_etag(manifest_v1) != compute_etag(manifest_v2)


def test_etag_stable_for_same_content():
    from app.services.imports.publisher import compute_etag
    m = {"name": "x", "plugins": [{"name": "y"}]}
    assert compute_etag(m) == compute_etag(m)
