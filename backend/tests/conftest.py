"""Shared test fixtures for SkillNote backend tests.

Tests that use these fixtures inherit them through pytest's conftest hierarchy.
Existing test files have inline duplicates of these helpers; those continue to
work unchanged. New tests (Tasks 29+) should use the shared fixtures here.
"""
import json
import os
import urllib.error
import urllib.request
import uuid
from typing import Optional

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


DB_URL = os.environ.get(
    "SKILLNOTE_DATABASE_URL",
    "postgresql+psycopg://skillnote:skillnote@localhost:5432/skillnote",
)
BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


@pytest.fixture(scope="session")
def engine():
    """Postgres engine (session-scoped). Skips tests if DB unreachable."""
    e = create_engine(DB_URL)
    try:
        with e.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as exc:
        pytest.skip(f"DB not reachable: {exc}")
    return e


@pytest.fixture
def db_session(engine):
    """Per-test SQLAlchemy session. Rolls back on exit."""
    S = sessionmaker(bind=engine)
    with S() as s:
        yield s
        s.rollback()


@pytest.fixture
def api_request():
    """Return a _req(method, path, body) helper that hits BASE_URL.

    Returns (status_code, parsed_json_body_or_none). Skips the test if the
    API is unreachable (e.g. running tests without the backend up).
    """
    def _req(method: str, path: str, body: Optional[dict] = None):
        req = urllib.request.Request(
            f"{BASE_URL}{path}",
            method=method,
            headers={"Content-Type": "application/json"} if body else {},
            data=(json.dumps(body).encode() if body else None),
        )
        try:
            with urllib.request.urlopen(req) as r:
                text_ = r.read().decode()
                return r.status, (json.loads(text_) if text_ else None)
        except urllib.error.HTTPError as e:
            text_ = e.read().decode()
            return e.code, (json.loads(text_) if text_ else None)
        except Exception as e:
            pytest.skip(f"API not reachable: {e}")
    return _req


@pytest.fixture
def unique_slug():
    """Generate a unique collection slug for test isolation."""
    return f"t-{uuid.uuid4().hex[:8]}"
