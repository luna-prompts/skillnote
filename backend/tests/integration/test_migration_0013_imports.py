"""Integration tests for migration 0013: import_sources table + skill additions."""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

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
    suffix = uuid.uuid4().hex[:8]
    coll_name = f"test-cascade-{suffix}"
    url = f"test-url-{suffix}"
    src_id = str(uuid.uuid4())

    with engine.connect() as conn:
        # Defensive pre-clean (safe: identifiers are unique per run).
        conn.execute(text("DELETE FROM import_sources WHERE url=:url"), {"url": url})
        conn.execute(text("DELETE FROM collections WHERE name=:name"), {"name": coll_name})
        conn.commit()

        try:
            conn.execute(text(
                "INSERT INTO collections (name, description, created_at, updated_at) "
                "VALUES (:name, 'test', now(), now())"
            ), {"name": coll_name})
            conn.execute(text(
                "INSERT INTO import_sources (id, source_type, url, kind, collection_name, status, created_at, updated_at) "
                "VALUES (:id, 'github', :url, 'marketplace', :name, 'up_to_date', now(), now())"
            ), {"id": src_id, "url": url, "name": coll_name})
            conn.commit()

            conn.execute(text("DELETE FROM collections WHERE name=:name"), {"name": coll_name})
            conn.commit()

            exists = conn.execute(text(
                "SELECT 1 FROM import_sources WHERE id=:id"
            ), {"id": src_id}).scalar()
            assert exists is None, "cascade didn't remove import_source"
        finally:
            # Defensive cleanup for both success and assertion-failure paths.
            conn.execute(text("DELETE FROM import_sources WHERE url=:url"), {"url": url})
            conn.execute(text("DELETE FROM collections WHERE name=:name"), {"name": coll_name})
            conn.commit()


def test_fk_on_delete_set_null_on_skills(engine):
    """Deleting an import_source nulls skill.import_source_id but keeps the skill."""
    suffix = uuid.uuid4().hex[:8]
    coll_name = f"test-setnull-{suffix}"
    url = f"test-setnull-url-{suffix}"
    src_id = str(uuid.uuid4())
    skill_id = str(uuid.uuid4())
    skill_name = f"test-setnull-skill-{suffix}"
    skill_slug = f"test-setnull-skill-{suffix}"

    with engine.connect() as conn:
        # Defensive pre-clean.
        conn.execute(text("DELETE FROM skills WHERE id=:id"), {"id": skill_id})
        conn.execute(text("DELETE FROM import_sources WHERE url=:url"), {"url": url})
        conn.execute(text("DELETE FROM collections WHERE name=:name"), {"name": coll_name})
        conn.commit()

        try:
            conn.execute(text(
                "INSERT INTO collections (name, description, created_at, updated_at) "
                "VALUES (:name, 'test', now(), now())"
            ), {"name": coll_name})
            conn.execute(text(
                "INSERT INTO import_sources (id, source_type, url, kind, collection_name, status, created_at, updated_at) "
                "VALUES (:id, 'github', :url, 'marketplace', :name, 'up_to_date', now(), now())"
            ), {"id": src_id, "url": url, "name": coll_name})
            conn.execute(text(
                "INSERT INTO skills (id, name, slug, description, import_source_id, created_at, updated_at) "
                "VALUES (:id, :name, :slug, 'test', :src_id, now(), now())"
            ), {"id": skill_id, "name": skill_name, "slug": skill_slug, "src_id": src_id})
            conn.commit()

            conn.execute(text("DELETE FROM import_sources WHERE id=:id"), {"id": src_id})
            conn.commit()

            row = conn.execute(text(
                "SELECT import_source_id FROM skills WHERE id=:id"
            ), {"id": skill_id}).first()
            assert row is not None, "skill was deleted instead of nulled"
            assert row[0] is None, f"import_source_id should be NULL, got {row[0]}"
        finally:
            conn.execute(text("DELETE FROM skills WHERE id=:id"), {"id": skill_id})
            conn.execute(text("DELETE FROM import_sources WHERE url=:url"), {"url": url})
            conn.execute(text("DELETE FROM collections WHERE name=:name"), {"name": coll_name})
            conn.commit()


def test_unique_constraint_canonical_enforced(engine):
    """uq_import_sources_canonical rejects duplicate (url, ref, subpath) tuples."""
    suffix = uuid.uuid4().hex[:8]
    coll_name = f"test-uq-{suffix}"
    url = f"test-uq-url-{suffix}"
    ref = "refs/heads/main"
    subpath = "skills/foo"
    src_id_a = str(uuid.uuid4())
    src_id_b = str(uuid.uuid4())

    with engine.connect() as conn:
        # Defensive pre-clean.
        conn.execute(text("DELETE FROM import_sources WHERE url=:url"), {"url": url})
        conn.execute(text("DELETE FROM collections WHERE name=:name"), {"name": coll_name})
        conn.commit()

        try:
            conn.execute(text(
                "INSERT INTO collections (name, description, created_at, updated_at) "
                "VALUES (:name, 'test', now(), now())"
            ), {"name": coll_name})
            conn.execute(text(
                "INSERT INTO import_sources "
                "(id, source_type, url, ref, subpath, kind, collection_name, status, created_at, updated_at) "
                "VALUES (:id, 'github', :url, :ref, :subpath, 'marketplace', :name, 'up_to_date', now(), now())"
            ), {"id": src_id_a, "url": url, "ref": ref, "subpath": subpath, "name": coll_name})
            conn.commit()

            # Second insert with same (url, ref, subpath) but different id + kind should fail.
            with pytest.raises(IntegrityError):
                conn.execute(text(
                    "INSERT INTO import_sources "
                    "(id, source_type, url, ref, subpath, kind, collection_name, status, created_at, updated_at) "
                    "VALUES (:id, 'git', :url, :ref, :subpath, 'plugin', :name, 'up_to_date', now(), now())"
                ), {"id": src_id_b, "url": url, "ref": ref, "subpath": subpath, "name": coll_name})
                conn.commit()
            conn.rollback()
        finally:
            conn.execute(text("DELETE FROM import_sources WHERE url=:url"), {"url": url})
            conn.execute(text("DELETE FROM collections WHERE name=:name"), {"name": coll_name})
            conn.commit()
