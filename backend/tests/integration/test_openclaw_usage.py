"""Integration tests for POST/GET /v1/openclaw/usage.

Mirrors the fixture style of test_openclaw_context_bundle.py: per-test fresh
FastAPI app mounting only the openclaw router, real Postgres.
"""
from __future__ import annotations

import os
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.api.openclaw import router
from app.db.models import Collection, Skill, SkillUsageEvent
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
    """Fresh FastAPI app mounting only the openclaw router."""
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


@pytest.fixture
def cleanup(db_session):
    """Track inserted skills, usage events, and collections; remove on teardown."""
    skill_ids: list[uuid.UUID] = []
    event_ids: list[uuid.UUID] = []
    collection_names: list[str] = []
    yield {"skills": skill_ids, "events": event_ids, "collections": collection_names}
    if event_ids:
        db_session.execute(
            text("DELETE FROM skill_usage_events WHERE id = ANY(:ids)"),
            {"ids": [str(i) for i in event_ids]},
        )
    if skill_ids:
        db_session.execute(
            text("DELETE FROM skill_usage_events WHERE skill_ids ?| :ids"),
            {"ids": [str(i) for i in skill_ids]},
        )
        db_session.execute(
            text("DELETE FROM skills WHERE id = ANY(:ids)"),
            {"ids": [str(i) for i in skill_ids]},
        )
    if collection_names:
        db_session.execute(
            text("DELETE FROM collections WHERE name = ANY(:names)"),
            {"names": collection_names},
        )
    db_session.commit()


# ── helpers ─────────────────────────────────────────────────────────────


def _seed_collection(db_session, cleanup) -> Collection:
    name = f"oc-col-{uuid.uuid4().hex[:8]}"
    col = Collection(name=name, description="test collection")
    db_session.add(col)
    db_session.commit()
    db_session.refresh(col)
    cleanup["collections"].append(name)
    return col


def _seed_skill(db_session, cleanup, *, name: str | None = None) -> Skill:
    suffix = uuid.uuid4().hex[:8]
    name = name or f"oc-usage-{suffix}"
    skill = Skill(
        id=uuid.uuid4(),
        name=name,
        slug=name,
        description=f"desc {suffix}",
        collections=[],
    )
    db_session.add(skill)
    db_session.commit()
    db_session.refresh(skill)
    cleanup["skills"].append(skill.id)
    return skill


def _seed_event(
    db_session,
    cleanup,
    *,
    skill_ids: list[uuid.UUID] | None = None,
    created_at: datetime | None = None,
    agent_name: str = "claude",
    task_summary: str = "t",
) -> SkillUsageEvent:
    event = SkillUsageEvent(
        id=uuid.uuid4(),
        agent_name=agent_name,
        task_summary=task_summary,
        skill_ids=[str(s) for s in (skill_ids or [])],
    )
    db_session.add(event)
    db_session.commit()
    if created_at is not None:
        db_session.execute(
            text("UPDATE skill_usage_events SET created_at = :ts WHERE id = :id"),
            {"ts": created_at, "id": str(event.id)},
        )
        db_session.commit()
        db_session.refresh(event)
    cleanup["events"].append(event.id)
    return event


# ── POST tests ──────────────────────────────────────────────────────────


def test_post_valid_event_returns_201(client, cleanup, db_session):
    r = client.post(
        "/v1/openclaw/usage",
        json={"agent_name": "claude", "task_summary": "ran the tests"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert "id" in body
    assert "created_at" in body
    assert body["skill_ids"] == []
    assert body["agent_name"] == "claude"
    cleanup["events"].append(uuid.UUID(body["id"]))


def test_post_with_skill_ids_succeeds(client, cleanup, db_session):
    s1 = _seed_skill(db_session, cleanup)
    s2 = _seed_skill(db_session, cleanup)
    r = client.post(
        "/v1/openclaw/usage",
        json={
            "agent_name": "claude",
            "task_summary": "ran two skills",
            "skill_ids": [str(s1.id), str(s2.id)],
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert set(body["skill_ids"]) == {str(s1.id), str(s2.id)}
    cleanup["events"].append(uuid.UUID(body["id"]))


def test_post_unknown_skill_id_422(client, cleanup, db_session):
    bogus = uuid.uuid4()
    r = client.post(
        "/v1/openclaw/usage",
        json={
            "agent_name": "claude",
            "task_summary": "missing skill",
            "skill_ids": [str(bogus)],
        },
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "UNKNOWN_SKILL_ID"


def test_post_task_summary_too_long_422(client, cleanup):
    # 1500 chars: under the schema's 2000 cap, but over the runtime 1000 cap.
    long_summary = "x" * 1500
    r = client.post(
        "/v1/openclaw/usage",
        json={"agent_name": "claude", "task_summary": long_summary},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "TASK_SUMMARY_TOO_LONG"


def test_post_invalid_risk_level_422(client, cleanup):
    r = client.post(
        "/v1/openclaw/usage",
        json={
            "agent_name": "claude",
            "task_summary": "x",
            "risk_level": "extreme",
        },
    )
    assert r.status_code == 422, r.text
    # Pydantic envelope — code is VALIDATION_ERROR (handler in main.py)
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_post_invalid_outcome_422(client, cleanup):
    r = client.post(
        "/v1/openclaw/usage",
        json={
            "agent_name": "claude",
            "task_summary": "x",
            "outcome": "weird",
        },
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_post_resolver_confidence_out_of_range_422(client, cleanup):
    r = client.post(
        "/v1/openclaw/usage",
        json={
            "agent_name": "claude",
            "task_summary": "x",
            "resolver_confidence": 2.0,
        },
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


# ── GET tests ───────────────────────────────────────────────────────────


def test_get_returns_recent_events_default_50(client, cleanup, db_session):
    # Seed 75 events tagged with a unique agent_name AND with future timestamps
    # so they dominate the descending-by-created_at order. The endpoint is
    # global (no agent filter), so other suites' inserts could otherwise crowd
    # us out of the first 50.
    base = datetime.now(timezone.utc) + timedelta(days=1)
    unique_agent = f"default50-test-{uuid.uuid4().hex[:12]}"
    for i in range(75):
        _seed_event(
            db_session, cleanup,
            agent_name=unique_agent,
            created_at=base + timedelta(seconds=i),
        )

    r = client.get("/v1/openclaw/usage")
    assert r.status_code == 200, r.text
    body = r.json()
    mine = [e for e in body if e["agent_name"] == unique_agent]
    assert len(mine) == 50, f"expected default limit 50, got {len(mine)}"

    # Ordered created_at desc among our tagged events.
    mine_ts = [datetime.fromisoformat(e["created_at"]) for e in mine]
    assert mine_ts == sorted(mine_ts, reverse=True)


def test_get_with_limit_truncates(client, cleanup, db_session):
    for _ in range(15):
        _seed_event(db_session, cleanup)
    r = client.get("/v1/openclaw/usage?limit=10")
    assert r.status_code == 200, r.text
    assert len(r.json()) == 10


def test_get_with_since_filter(client, cleanup, db_session):
    now = datetime.now(timezone.utc)
    # Use a unique agent_name so we can scope our assertion to just our 3 rows.
    tag = f"since-test-{uuid.uuid4().hex[:8]}"
    _seed_event(
        db_session, cleanup,
        agent_name=tag, created_at=now - timedelta(hours=1),
    )
    _seed_event(db_session, cleanup, agent_name=tag, created_at=now)
    _seed_event(
        db_session, cleanup,
        agent_name=tag, created_at=now - timedelta(minutes=30),
    )

    # urlencode the ISO timestamp — '+' in '+00:00' would otherwise decode as ' '.
    cutoff = urllib.parse.quote((now - timedelta(minutes=45)).isoformat())
    r = client.get(f"/v1/openclaw/usage?since={cutoff}&limit=200")
    assert r.status_code == 200, r.text
    ours = [e for e in r.json() if e["agent_name"] == tag]
    assert len(ours) == 2


def test_get_with_skill_id_filter(client, cleanup, db_session):
    sx = _seed_skill(db_session, cleanup)
    sy = _seed_skill(db_session, cleanup)
    e1 = _seed_event(db_session, cleanup, skill_ids=[sx.id])
    e2 = _seed_event(db_session, cleanup, skill_ids=[sx.id])
    e3 = _seed_event(db_session, cleanup, skill_ids=[sy.id])

    r = client.get(f"/v1/openclaw/usage?skill_id={sx.id}&limit=200")
    assert r.status_code == 200, r.text
    body = r.json()
    returned_ids = {e["id"] for e in body}
    assert str(e1.id) in returned_ids
    assert str(e2.id) in returned_ids
    assert str(e3.id) not in returned_ids
    # Every returned event must contain sx.id (other tests in the DB might
    # have rows referencing sx if names collided, but our suffixed ids are
    # unique so the only matches should be our two).
    matching_only = [e for e in body if str(sx.id) in e["skill_ids"]]
    assert len(matching_only) == 2


def test_get_with_before_cursor_paginates(client, cleanup, db_session):
    # Seed 5 events with strictly increasing timestamps so ordering is stable.
    base = datetime.now(timezone.utc)
    tag = f"page-test-{uuid.uuid4().hex[:8]}"
    events = []
    for i in range(5):
        # i=0 → oldest; events list is in insertion (chronological) order.
        events.append(
            _seed_event(
                db_session, cleanup,
                agent_name=tag,
                created_at=base - timedelta(seconds=(4 - i)),
            )
        )

    # Page 1: newest two of *our* 5. Use a high limit + filter client-side
    # (the endpoint is global; we can't filter by agent_name in the URL).
    r = client.get("/v1/openclaw/usage?limit=200")
    assert r.status_code == 200, r.text
    ours = [e for e in r.json() if e["agent_name"] == tag]
    # ours is sorted created_at desc → ours[0] is the newest (events[4]).
    assert len(ours) == 5
    assert ours[0]["id"] == str(events[4].id)
    assert ours[1]["id"] == str(events[3].id)

    # Page 2: cursor from ours[1] (events[3]) — next page should start at events[2].
    # urlencode the cursor — '+' in the embedded ISO tz offset would decode as ' '.
    cursor = urllib.parse.quote(f"{ours[1]['created_at']}:{ours[1]['id']}")
    r2 = client.get(f"/v1/openclaw/usage?before={cursor}&limit=200")
    assert r2.status_code == 200, r2.text
    ours2 = [e for e in r2.json() if e["agent_name"] == tag]
    # No overlap with page 1: events[4] and events[3] must not appear.
    page1_ids = {str(events[4].id), str(events[3].id)}
    page2_ids = {e["id"] for e in ours2}
    assert page1_ids.isdisjoint(page2_ids)
    # Top of page 2 must be events[2] (the next-newest after the cursor).
    assert ours2[0]["id"] == str(events[2].id)


def test_get_with_invalid_cursor_422(client, cleanup):
    r = client.get("/v1/openclaw/usage?before=garbage")
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "INVALID_CURSOR"


# ── Bug fix tests ────────────────────────────────────────────────────────


def test_post_unknown_collection_id_422(client, cleanup, db_session):
    """POST with a collection_id that doesn't exist must return 422, not 500.

    Bug: before the fix, the missing FK check let the INSERT reach Postgres,
    which raised an IntegrityError that fell through to the generic 500 handler.
    """
    r = client.post(
        "/v1/openclaw/usage",
        json={
            "agent_name": "claude",
            "task_summary": "testing unknown collection",
            "collection_id": "does-not-exist-at-all",
        },
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "UNKNOWN_COLLECTION_ID"


def test_post_known_collection_id_succeeds(client, cleanup, db_session):
    """POST with a real collection_id is accepted and round-trips."""
    col = _seed_collection(db_session, cleanup)
    r = client.post(
        "/v1/openclaw/usage",
        json={
            "agent_name": "claude",
            "task_summary": "real collection",
            "collection_id": col.name,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["collection_id"] == col.name
    cleanup["events"].append(uuid.UUID(body["id"]))


def test_post_deduplicates_skill_ids(client, cleanup, db_session):
    """Duplicate skill IDs in one event must be stored only once.

    Bug: before the fix, sending the same skill UUID twice in skill_ids stored
    both entries, inflating usage_count_30d by 2 per event instead of 1.
    """
    skill = _seed_skill(db_session, cleanup)
    r = client.post(
        "/v1/openclaw/usage",
        json={
            "agent_name": "claude",
            "task_summary": "dedup check",
            "skill_ids": [str(skill.id), str(skill.id)],
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["skill_ids"] == [str(skill.id)], (
        f"expected one entry after dedup, got {body['skill_ids']}"
    )
    cleanup["events"].append(uuid.UUID(body["id"]))
