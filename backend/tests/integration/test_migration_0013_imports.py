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
