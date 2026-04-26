"""Integration tests for POST /v1/openclaw/context-bundle.

Runs in-process via fastapi.testclient.TestClient with a fresh app that mounts
only the openclaw router (the router is not yet wired into main.py — that's a
future task). Real Postgres is required (uses pgvector cosine distance).

Embeddings are mocked — these tests never call the real OpenAI/Voyage API.
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
from app.services import embedding_service


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


@pytest.fixture(autouse=True)
def _configure_embedding(monkeypatch):
    """Default: embedding service appears configured. Tests that need the
    'not configured' branch override this with their own monkeypatch."""
    monkeypatch.setattr(embedding_service.settings, "embedding_api_key", "test-key")
    yield


def _mock_embed_text(monkeypatch, vector_idx: int = 0):
    """Replace embedding_service.embed_text with a deterministic stub vector."""
    monkeypatch.setattr(
        embedding_service, "embed_text", lambda _t: _vec(vector_idx)
    )


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


def _vec(idx: int, dim: int = 1536) -> list[float]:
    """A unit basis vector with 1.0 at position idx and 0.0 elsewhere."""
    v = [0.0] * dim
    v[idx] = 1.0
    return v


def _seed_skill(
    db_session,
    cleanup,
    *,
    name: str | None = None,
    embedding: list[float] | None,
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
        embedding=embedding,
    )
    db_session.add(skill)
    db_session.commit()
    db_session.refresh(skill)
    cleanup.append(skill.id)
    return skill


# ── tests ───────────────────────────────────────────────────────────────


def test_503_when_embedding_not_configured(client, monkeypatch):
    monkeypatch.setattr(embedding_service.settings, "embedding_api_key", None)
    r = client.post("/v1/openclaw/context-bundle", json={"task_summary": "anything"})
    assert r.status_code == 503, r.text
    body = r.json()
    assert body["error"]["code"] == "EMBEDDING_NOT_CONFIGURED"


def test_empty_registry_returns_empty_arrays(client, monkeypatch, db_session):
    """When there are zero embedded skills, response.skills should be empty.

    We don't try to assert the collections list is empty — other tests in this
    DB likely seeded collections — we just assert the call succeeds and the
    skills list is empty when no skill matches the (mocked) query vector.
    """
    _mock_embed_text(monkeypatch, 0)
    # Wipe just the embeddings (don't delete skills — other tests rely on them)
    db_session.execute(text("UPDATE skills SET embedding = NULL"))
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
        db_session.rollback()


def test_5_skills_ranked_by_cosine(client, monkeypatch, db_session, cleanup):
    """Skill whose embedding aligns with the query vector ranks first."""
    # Seed 5 skills, each with a unit vector pointing in a distinct dimension.
    skills = [
        _seed_skill(db_session, cleanup, embedding=_vec(i)) for i in range(5)
    ]
    target = skills[2]
    _mock_embed_text(monkeypatch, 2)
    r = client.post(
        "/v1/openclaw/context-bundle",
        json={"task_summary": "rank test"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Filter to just our seeded skills (DB may contain others)
    seeded_ids = {str(s.id) for s in skills}
    returned_seeded = [s for s in body["skills"] if s["id"] in seeded_ids]
    assert returned_seeded, body
    # First seeded skill in ranking order must be the target
    assert returned_seeded[0]["id"] == str(target.id), [
        (s["id"], s["slug"]) for s in returned_seeded
    ]


def test_skill_with_null_embedding_excluded(client, monkeypatch, db_session, cleanup):
    """Skills with NULL embedding are dropped from the ranked list."""
    embedded = _seed_skill(db_session, cleanup, embedding=_vec(0))
    _seed_skill(db_session, cleanup, embedding=None)
    _seed_skill(db_session, cleanup, embedding=None)

    _mock_embed_text(monkeypatch, 0)
    r = client.post(
        "/v1/openclaw/context-bundle", json={"task_summary": "hi"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    seeded_ids = {str(embedded.id)}  # only the embedded one should appear
    returned_ids = {s["id"] for s in body["skills"]}
    # All three of our seeded skills should have been candidates, but only the
    # embedded one is allowed back.
    assert str(embedded.id) in returned_ids
    null_ids = [s["id"] for s in body["skills"] if uuid.UUID(s["id"]) in cleanup and s["id"] != str(embedded.id)]
    assert null_ids == [], f"NULL-embedding skills leaked through: {null_ids}"


def test_staleness_via_deprecation_comment(client, monkeypatch, db_session, cleanup):
    skill = _seed_skill(db_session, cleanup, embedding=_vec(0))
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

    _mock_embed_text(monkeypatch, 0)
    r = client.post(
        "/v1/openclaw/context-bundle", json={"task_summary": "x"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    found = next(s for s in body["skills"] if s["id"] == str(skill.id))
    assert found["staleness_status"] == "needs_review"


def test_staleness_via_low_rating(client, monkeypatch, db_session, cleanup):
    skill = _seed_skill(db_session, cleanup, embedding=_vec(0))
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

    _mock_embed_text(monkeypatch, 0)
    r = client.post(
        "/v1/openclaw/context-bundle", json={"task_summary": "x"}
    )
    assert r.status_code == 200, r.text
    found = next(s for s in r.json()["skills"] if s["id"] == str(skill.id))
    assert found["staleness_status"] == "needs_review"
    assert found["rating_avg"] is not None
    assert abs(found["rating_avg"] - 2.0) < 0.001


def test_max_skills_truncates(client, monkeypatch, db_session, cleanup):
    """max_skills caps the returned ranked-skills list."""
    for _ in range(10):
        _seed_skill(db_session, cleanup, embedding=_vec(0))

    _mock_embed_text(monkeypatch, 0)
    r = client.post(
        "/v1/openclaw/context-bundle",
        json={"task_summary": "x", "max_skills": 3},
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["skills"]) == 3


def test_n_plus_1_sentinel(client, monkeypatch, db_session, cleanup, engine):
    """Endpoint must execute ≤ 6 queries regardless of skill count."""
    for _ in range(20):
        _seed_skill(db_session, cleanup, embedding=_vec(0))

    _mock_embed_text(monkeypatch, 0)

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


def test_502_on_embedding_provider_error(client, monkeypatch):
    def boom(_text):
        raise embedding_service.EmbeddingError("rate limited")

    monkeypatch.setattr(embedding_service, "embed_text", boom)
    r = client.post(
        "/v1/openclaw/context-bundle", json={"task_summary": "x"}
    )
    assert r.status_code == 502, r.text
    assert r.json()["error"]["code"] == "EMBEDDING_PROVIDER_ERROR"


def test_recent_comment_summary_truncated_to_200_chars(
    client, monkeypatch, db_session, cleanup
):
    skill = _seed_skill(db_session, cleanup, embedding=_vec(0))
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

    _mock_embed_text(monkeypatch, 0)
    r = client.post(
        "/v1/openclaw/context-bundle", json={"task_summary": "x"}
    )
    assert r.status_code == 200, r.text
    found = next(s for s in r.json()["skills"] if s["id"] == str(skill.id))
    assert len(found["recent_comments_summary"]) == 200
    assert found["recent_comments_summary"] == "x" * 200


def test_usage_count_30d_aggregation(client, monkeypatch, db_session, cleanup):
    """SkillUsageEvent rows in the 30d window are counted; older ones aren't."""
    skill = _seed_skill(db_session, cleanup, embedding=_vec(0))
    # 2 recent events referencing this skill
    for _ in range(2):
        db_session.add(
            SkillUsageEvent(
                id=uuid.uuid4(),
                agent_name="claude",
                task_summary="t",
                skill_ids=[str(skill.id)],
            )
        )
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

    _mock_embed_text(monkeypatch, 0)
    r = client.post(
        "/v1/openclaw/context-bundle", json={"task_summary": "x"}
    )
    assert r.status_code == 200, r.text
    found = next(s for s in r.json()["skills"] if s["id"] == str(skill.id))
    assert found["usage_count_30d"] == 2
