"""Regression tests for `GET /v1/skills?include=content`.

Bodies were dropped from the list response to keep the web app's
localStorage cache under quota (issue #65). Every file-syncing agent plugin
reads bodies from that same endpoint, so they opt in with `include=content`.
Without it they write frontmatter-only stubs — and their change-detection
then overwrites good files on disk with those stubs.

Requires a running backend + the same Postgres. Skips if unreachable.
"""
import json
import os
import urllib.error
import urllib.request
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
DB_URL = os.environ.get(
    "SKILLNOTE_DATABASE_URL",
    "postgresql+psycopg://skillnote:skillnote@localhost:5432/skillnote",
)


def _get(path: str):
    try:
        with urllib.request.urlopen(f"{BASE_URL}{path}") as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


@pytest.fixture(scope="module")
def engine():
    e = create_engine(DB_URL)
    try:
        with e.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as exc:
        pytest.skip(f"DB not reachable: {exc}")
    return e


@pytest.fixture
def skill(engine):
    """A skill with a known body, cleaned up afterwards."""
    Session = sessionmaker(bind=engine)
    slug = f"inc-test-{uuid.uuid4().hex[:8]}"
    body = "# Heading\n\nReal instructions for the agent."
    with Session() as s:
        s.execute(
            text(
                "INSERT INTO skills (id, slug, name, description, content_md, "
                "current_version, collections, created_at, updated_at) "
                "VALUES (:id, :slug, :slug, 'fixture', :body, 1, "
                "ARRAY['conventions']::text[], NOW(), NOW())"
            ),
            {"id": str(uuid.uuid4()), "slug": slug, "body": body},
        )
        s.commit()
    yield slug, body
    with Session() as s:
        s.execute(text("DELETE FROM skills WHERE slug = :s"), {"s": slug})
        s.commit()


def _find(rows, slug):
    return next((r for r in rows if r["slug"] == slug), None)


def test_list_omits_bodies_by_default(skill):
    slug, _ = skill
    status, rows = _get("/v1/skills")
    assert status == 200
    row = _find(rows, slug)
    assert row is not None
    # Absent entirely, not empty: the default payload must stay small.
    assert "content_md" not in row


def test_include_content_embeds_the_body(skill):
    slug, body = skill
    status, rows = _get("/v1/skills?include=content")
    assert status == 200
    row = _find(rows, slug)
    assert row is not None
    assert row["content_md"] == body


def test_include_content_composes_with_the_collections_filter(skill):
    slug, body = skill
    status, rows = _get("/v1/skills?include=content&collections=conventions")
    assert status == 200
    row = _find(rows, slug)
    assert row is not None
    assert row["content_md"] == body


def test_unknown_include_values_are_ignored(skill):
    slug, _ = skill
    status, rows = _get("/v1/skills?include=nonsense")
    assert status == 200
    assert "content_md" not in _find(rows, slug)
