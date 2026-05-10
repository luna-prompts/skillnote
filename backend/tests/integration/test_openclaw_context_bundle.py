"""Integration tests for POST /v1/openclaw/context-bundle.

Runs in-process via fastapi.testclient.TestClient with a fresh app that mounts
only the openclaw router. Real Postgres is required (uses JSONB aggregations
+ ARRAY membership checks). No embedding service / no OpenAI / no pgvector —
the OpenClaw resolver subagent does the LLM-side ranking; SkillNote just
ships the catalog sorted by usage_count_30d desc then rating_avg desc.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

from app.api.openclaw import router
from app.db.models import Comment, Skill, SkillUsageEvent
from app.db.session import get_db
from app.main import http_exception_handler, validation_exception_handler


DB_URL = os.environ.get(
    "SKILLNOTE_DATABASE_URL",
    "postgresql+psycopg://skillnote:skillnote@localhost:5432/skillnote",
)


# ── fixtures ────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def engine():
    """Module-scoped Postgres engine. Skips the module if DB is unreachable."""
    e = create_engine(DB_URL, future=True)
    try:
        with e.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as exc:
        pytest.skip(f"DB not reachable: {exc}")
    return e


@pytest.fixture
def db_session(engine):
    """Per-test session. Caller is expected to commit + clean up explicitly."""
    S = sessionmaker(bind=engine, future=True)
    with S() as s:
        yield s
        s.rollback()


@pytest.fixture
def client(engine):
    """Fresh FastAPI app mounting only the openclaw router.

    Overrides get_db so the request handler binds to our test engine instead of
    the module-level SessionLocal. Includes the same exception handlers main.py
    uses so error envelopes match production.
    """
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
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


@pytest.fixture
def cleanup(db_session):
    """Track inserted skills/comments/usage events and remove them on teardown."""
    skill_ids: list[uuid.UUID] = []
    yield skill_ids
    if skill_ids:
        db_session.execute(
            text("DELETE FROM comments WHERE skill_id = ANY(:ids)"),
            {"ids": [str(i) for i in skill_ids]},
        )
        db_session.execute(
            text("DELETE FROM skill_usage_events WHERE skill_ids ?| :ids"),
            {"ids": [str(i) for i in skill_ids]},
        )
        db_session.execute(
            text("DELETE FROM skills WHERE id = ANY(:ids)"),
            {"ids": [str(i) for i in skill_ids]},
        )
        db_session.commit()


# ── helpers ─────────────────────────────────────────────────────────────


def _seed_skill(
    db_session,
    cleanup,
    *,
    name: str | None = None,
    collections: list[str] | None = None,
) -> Skill:
    suffix = uuid.uuid4().hex[:8]
    name = name or f"oc-{suffix}"
    skill = Skill(
        id=uuid.uuid4(),
        name=name,
        slug=name,
        description=f"desc {suffix}",
        collections=collections or [],
    )
    db_session.add(skill)
    db_session.commit()
    db_session.refresh(skill)
    cleanup.append(skill.id)
    return skill


def _add_usage_events(db_session, skill_id: uuid.UUID, count: int) -> None:
    """Insert ``count`` recent usage events that reference ``skill_id``."""
    for _ in range(count):
        db_session.add(
            SkillUsageEvent(
                id=uuid.uuid4(),
                agent_name="claude",
                task_summary="t",
                skill_ids=[str(skill_id)],
            )
        )
    db_session.commit()


# ── tests ───────────────────────────────────────────────────────────────


def test_empty_registry_returns_empty_arrays(client, db_session):
    """When there are zero skills, response.skills should be empty.

    We don't try to assert the collections list is empty — other tests in this
    DB likely seeded collections — we just assert the call succeeds and the
    skills list is empty when the skills table itself is empty.

    NOTE: this test commits a DELETE on every skill row. The fixture's
    session.rollback() can't undo a committed change, so we snapshot every
    skill row and restore them in `finally` so subsequent tests aren't
    starved of seeded skills.
    """
    saved = db_session.execute(
        text(
            "SELECT id, name, slug, description, collections "
            "FROM skills"
        )
    ).fetchall()
    # Wipe every skill — we want the genuinely empty case.
    db_session.execute(text("DELETE FROM comments"))
    db_session.execute(text("DELETE FROM skill_usage_events"))
    db_session.execute(text("DELETE FROM skills"))
    db_session.commit()
    try:
        r = client.post(
            "/v1/openclaw/context-bundle", json={"task_summary": "hello"}
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["skills"] == []
        assert isinstance(body["collections"], list)
    finally:
        for row in saved:
            db_session.execute(
                text(
                    "INSERT INTO skills (id, name, slug, description, collections) "
                    "VALUES (:id, :name, :slug, :description, :collections)"
                ),
                {
                    "id": row.id,
                    "name": row.name,
                    "slug": row.slug,
                    "description": row.description,
                    "collections": row.collections,
                },
            )
        db_session.commit()


def test_staleness_via_deprecation_comment(client, db_session, cleanup):
    skill = _seed_skill(db_session, cleanup)
    db_session.add(
        Comment(
            id=uuid.uuid4(),
            skill_id=skill.id,
            author="agent-bot",
            body="this skill is deprecated",
            comment_type="agent_deprecation_warning",
        )
    )
    db_session.commit()

    r = client.post(
        "/v1/openclaw/context-bundle", json={"task_summary": "x"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    found = next(s for s in body["skills"] if s["id"] == str(skill.id))
    assert found["staleness_status"] == "needs_review"


def test_staleness_via_low_rating(client, db_session, cleanup):
    skill = _seed_skill(db_session, cleanup)
    for _ in range(3):
        db_session.add(
            Comment(
                id=uuid.uuid4(),
                skill_id=skill.id,
                author="rater",
                body="not great",
                rating=2,
            )
        )
    db_session.commit()

    r = client.post(
        "/v1/openclaw/context-bundle", json={"task_summary": "x"}
    )
    assert r.status_code == 200, r.text
    found = next(s for s in r.json()["skills"] if s["id"] == str(skill.id))
    assert found["staleness_status"] == "needs_review"
    assert found["rating_avg"] is not None
    assert abs(found["rating_avg"] - 2.0) < 0.001


def test_max_skills_truncates(client, db_session, cleanup):
    """max_skills caps the returned ranked-skills list."""
    for _ in range(10):
        _seed_skill(db_session, cleanup)

    r = client.post(
        "/v1/openclaw/context-bundle",
        json={"task_summary": "x", "max_skills": 3},
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["skills"]) == 3


def test_n_plus_1_sentinel(client, db_session, cleanup, engine):
    """Endpoint must execute ≤ 6 queries regardless of skill count."""
    for _ in range(20):
        _seed_skill(db_session, cleanup)

    counter = {"n": 0}

    def _before(conn, cursor, statement, parameters, context, executemany):
        # Filter out connection-setup chatter (BEGIN/COMMIT/ROLLBACK) — only
        # SELECT/INSERT/UPDATE/DELETE statements count toward the budget.
        s = statement.strip().upper()
        if s.startswith(("SELECT", "INSERT", "UPDATE", "DELETE", "WITH")):
            counter["n"] += 1

    event.listen(engine, "before_cursor_execute", _before)
    try:
        r = client.post(
            "/v1/openclaw/context-bundle",
            json={"task_summary": "x", "max_skills": 50},
        )
    finally:
        event.remove(engine, "before_cursor_execute", _before)

    assert r.status_code == 200, r.text
    assert counter["n"] <= 6, (
        f"Expected ≤6 SELECT/INSERT/UPDATE/DELETE queries, got {counter['n']}"
    )


def test_recent_comment_summary_truncated_to_200_chars(client, db_session, cleanup):
    skill = _seed_skill(db_session, cleanup)
    long_body = "x" * 500
    db_session.add(
        Comment(
            id=uuid.uuid4(),
            skill_id=skill.id,
            author="commenter",
            body=long_body,
            created_at=datetime.now(timezone.utc),
        )
    )
    db_session.commit()

    r = client.post(
        "/v1/openclaw/context-bundle", json={"task_summary": "x"}
    )
    assert r.status_code == 200, r.text
    found = next(s for s in r.json()["skills"] if s["id"] == str(skill.id))
    assert len(found["recent_comments_summary"]) == 200
    assert found["recent_comments_summary"] == "x" * 200


def test_usage_count_30d_aggregation(client, db_session, cleanup):
    """SkillUsageEvent rows in the 30d window are counted; older ones aren't."""
    skill = _seed_skill(db_session, cleanup)
    # 2 recent events referencing this skill
    _add_usage_events(db_session, skill.id, 2)
    # 1 older event — must be excluded
    old = SkillUsageEvent(
        id=uuid.uuid4(),
        agent_name="claude",
        task_summary="t",
        skill_ids=[str(skill.id)],
    )
    db_session.add(old)
    db_session.commit()
    db_session.execute(
        text("UPDATE skill_usage_events SET created_at = :ts WHERE id = :id"),
        {
            "ts": datetime.now(timezone.utc) - timedelta(days=45),
            "id": str(old.id),
        },
    )
    db_session.commit()

    r = client.post(
        "/v1/openclaw/context-bundle", json={"task_summary": "x"}
    )
    assert r.status_code == 200, r.text
    found = next(s for s in r.json()["skills"] if s["id"] == str(skill.id))
    assert found["usage_count_30d"] == 2


def test_ranking_prefers_high_usage(client, db_session, cleanup):
    """Of three skills, the one with most recent usage events ranks first."""
    high = _seed_skill(db_session, cleanup, name=f"oc-high-{uuid.uuid4().hex[:6]}")
    mid = _seed_skill(db_session, cleanup, name=f"oc-mid-{uuid.uuid4().hex[:6]}")
    low = _seed_skill(db_session, cleanup, name=f"oc-low-{uuid.uuid4().hex[:6]}")
    _add_usage_events(db_session, high.id, 10)
    _add_usage_events(db_session, mid.id, 5)
    # `low` gets zero usage events.

    r = client.post(
        "/v1/openclaw/context-bundle",
        json={"task_summary": "x", "max_skills": 100},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    seeded_ids = {str(high.id), str(mid.id), str(low.id)}
    returned_seeded = [s for s in body["skills"] if s["id"] in seeded_ids]
    # Order MUST be high → mid → low.
    assert [s["id"] for s in returned_seeded] == [
        str(high.id),
        str(mid.id),
        str(low.id),
    ], returned_seeded


def test_ranking_breaks_ties_by_rating(client, db_session, cleanup):
    """Equal usage_count_30d → higher rating_avg wins the tiebreak."""
    a = _seed_skill(db_session, cleanup, name=f"oc-a-{uuid.uuid4().hex[:6]}")
    b = _seed_skill(db_session, cleanup, name=f"oc-b-{uuid.uuid4().hex[:6]}")
    # Same usage count
    _add_usage_events(db_session, a.id, 5)
    _add_usage_events(db_session, b.id, 5)
    # `a` gets a high rating, `b` gets a low one.
    db_session.add(
        Comment(
            id=uuid.uuid4(),
            skill_id=a.id,
            author="rater",
            body="great",
            rating=5,
        )
    )
    db_session.add(
        Comment(
            id=uuid.uuid4(),
            skill_id=a.id,
            author="rater",
            body="great",
            rating=4,
        )
    )
    db_session.add(
        Comment(
            id=uuid.uuid4(),
            skill_id=b.id,
            author="rater",
            body="meh",
            rating=2,
        )
    )
    db_session.add(
        Comment(
            id=uuid.uuid4(),
            skill_id=b.id,
            author="rater",
            body="meh",
            rating=3,
        )
    )
    db_session.commit()

    r = client.post(
        "/v1/openclaw/context-bundle",
        json={"task_summary": "x", "max_skills": 100},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    seeded = [s for s in body["skills"] if s["id"] in {str(a.id), str(b.id)}]
    # `a` (higher rating) MUST come before `b`.
    assert [s["id"] for s in seeded] == [str(a.id), str(b.id)], seeded


def test_collection_filter_returns_subset(client, db_session, cleanup):
    """collection_filter narrows the bundle to skills in that collection."""
    target_collection = f"col-{uuid.uuid4().hex[:6]}"
    other_collection = f"col-{uuid.uuid4().hex[:6]}"
    in_a = _seed_skill(db_session, cleanup, collections=[target_collection])
    in_b = _seed_skill(db_session, cleanup, collections=[target_collection, "extra"])
    out = _seed_skill(db_session, cleanup, collections=[other_collection])

    r = client.post(
        "/v1/openclaw/context-bundle",
        json={
            "task_summary": "x",
            "max_skills": 100,
            "collection_filter": target_collection,
        },
    )
    assert r.status_code == 200, r.text
    returned_ids = {s["id"] for s in r.json()["skills"]}
    assert str(in_a.id) in returned_ids
    assert str(in_b.id) in returned_ids
    assert str(out.id) not in returned_ids


# ── Bug fix: empty collection_filter silently bypasses filter (Bug 1) ───


def test_context_bundle_empty_collection_filter_422(client):
    """collection_filter='' must be rejected; it would silently return all skills.

    Before the fix, an empty string bypassed the filter because the WHERE clause
    was only added when the Python string was truthy, but Pydantic accepted ''.
    """
    r = client.post(
        "/v1/openclaw/context-bundle",
        json={"task_summary": "find skills", "collection_filter": ""},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


# ── Bug fix: no ORDER BY on candidate fetch causes non-determinism (Bug 3) ─


def test_context_bundle_candidate_fetch_is_deterministic(client, db_session, cleanup):
    """Repeated calls with the same catalog must return the same skill ordering.

    Before the fix, the LIMIT max_skills*4 candidate fetch had no ORDER BY, so
    the DB could return different rows on each call depending on internal storage
    order — skills beyond the window were silently excluded.
    """
    col = f"det-col-{uuid.uuid4().hex[:6]}"
    skills = [_seed_skill(db_session, cleanup, collections=[col]) for _ in range(5)]
    skill_ids = {str(s.id) for s in skills}

    results = []
    for _ in range(3):
        r = client.post(
            "/v1/openclaw/context-bundle",
            json={"task_summary": "x", "max_skills": 3, "collection_filter": col},
        )
        assert r.status_code == 200, r.text
        results.append([s["id"] for s in r.json()["skills"]])

    # All three calls must return the exact same ordered list.
    assert results[0] == results[1] == results[2], (
        f"non-deterministic ordering: {results}"
    )
