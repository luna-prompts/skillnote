"""Regression tests for analytics endpoint parameter validation.

Bug 7: days=0 on summary/agents/skill-calls/top-skills/rating-summary/collections
was silently treated as "all time" (the helper returned an empty WHERE clause).
The timeline endpoint already rejected days=0 with ge=1; these tests verify the
remaining endpoints now enforce the same constraint uniformly.
"""
from __future__ import annotations

import os

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.api.analytics import router
from app.db.session import get_db
from app.main import (
    generic_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)


DB_URL = os.environ.get(
    "SKILLNOTE_DATABASE_URL",
    "postgresql+psycopg://skillnote:skillnote@localhost:5432/skillnote",
)


@pytest.fixture(scope="module")
def engine():
    e = create_engine(DB_URL, future=True)
    try:
        with e.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as exc:
        pytest.skip(f"DB not reachable: {exc}")
    return e


@pytest.fixture(scope="module")
def client(engine):
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)
    app.include_router(router)

    S = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    def _get_db_override():
        db = S()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_db_override
    return TestClient(app)


# ── days=0 must be rejected on all affected endpoints ───────────────────

_DAYS_ZERO_ENDPOINTS = [
    "/v1/analytics/summary",
    "/v1/analytics/skill-calls",
    "/v1/analytics/agents",
    "/v1/analytics/top-skills",
    "/v1/analytics/rating-summary",
    "/v1/analytics/collections",
    "/v1/analytics/timeline",  # already had ge=1; include to prevent regression
]


@pytest.mark.parametrize("url", _DAYS_ZERO_ENDPOINTS)
def test_days_zero_rejected(client, url):
    """days=0 must return 422 on every analytics endpoint that accepts days.

    Before the fix, summary/skill-calls/agents/top-skills/rating-summary/collections
    silently returned all-time data when days=0; only timeline correctly rejected it.
    """
    r = client.get(f"{url}?days=0")
    assert r.status_code == 422, f"{url}: expected 422, got {r.status_code}: {r.text}"


@pytest.mark.parametrize("url", _DAYS_ZERO_ENDPOINTS)
def test_days_positive_accepted(client, url):
    """days=1 must be accepted (basic sanity check that we didn't break ge=1)."""
    r = client.get(f"{url}?days=1")
    assert r.status_code == 200, f"{url}: expected 200, got {r.status_code}: {r.text}"
