"""Integration tests for the agent-reflection extensions to /v1/skills/{slug}/comments.

Mirrors the in-process FastAPI fixture pattern used by test_openclaw_usage.py:
fresh app per test (module-scoped engine), real Postgres, exception handlers
registered so error envelopes match production. The comments router is mounted
because that's the unit under test; the skills router is intentionally NOT
mounted — we seed skills directly via the ORM session, which is faster and
keeps the test surface focused on the comments handler.

Cleanup tracks comment ids, usage-event ids, and skill ids inserted during the
test and removes them on teardown so we leave the shared DB in a clean state.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.api.comments import router as comments_router
from app.db.models import Comment, Skill, SkillUsageEvent
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
    """Per-test session. Cleanup is handled by the `cleanup` fixture."""
    S = sessionmaker(bind=engine, future=True)
    with S() as s:
        yield s
        s.rollback()


@pytest.fixture
def client(engine):
    """Fresh FastAPI app mounting only the comments router."""
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)
    app.include_router(comments_router)

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
    """Track inserted skills/comments/usage events; remove them on teardown.

    Order matters: comments must be deleted before usage events (FK SET NULL
    would otherwise be a no-op, but the explicit order documents intent and
    matches the FK direction). Skills last so their cascade-delete on comments
    is a safe fallback.
    """
    skill_ids: list[uuid.UUID] = []
    event_ids: list[uuid.UUID] = []
    comment_ids: list[uuid.UUID] = []
    yield {"skills": skill_ids, "events": event_ids, "comments": comment_ids}
    if comment_ids:
        db_session.execute(
            text("DELETE FROM comments WHERE id = ANY(:ids)"),
            {"ids": [str(i) for i in comment_ids]},
        )
    if skill_ids:
        # Cascade also removes any comments we forgot to track.
        db_session.execute(
            text("DELETE FROM comments WHERE skill_id = ANY(:ids)"),
            {"ids": [str(i) for i in skill_ids]},
        )
    if event_ids:
        db_session.execute(
            text("DELETE FROM skill_usage_events WHERE id = ANY(:ids)"),
            {"ids": [str(i) for i in event_ids]},
        )
    if skill_ids:
        db_session.execute(
            text("DELETE FROM skills WHERE id = ANY(:ids)"),
            {"ids": [str(i) for i in skill_ids]},
        )
    db_session.commit()


# ── helpers ─────────────────────────────────────────────────────────────


def _seed_skill(db_session, cleanup) -> Skill:
    suffix = uuid.uuid4().hex[:8]
    name = f"cm-ext-{suffix}"
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


def _seed_usage_event(
    db_session,
    cleanup,
    *,
    skill_ids: list[uuid.UUID] | None = None,
) -> SkillUsageEvent:
    event = SkillUsageEvent(
        id=uuid.uuid4(),
        agent_name="claude",
        task_summary="reflection target",
        skill_ids=[str(s) for s in (skill_ids or [])],
    )
    db_session.add(event)
    db_session.commit()
    db_session.refresh(event)
    cleanup["events"].append(event.id)
    return event


# ── tests ───────────────────────────────────────────────────────────────


def test_post_human_comment_legacy_payload(client, db_session, cleanup):
    """Legacy POST with only {author, body} must still succeed and return defaults."""
    skill = _seed_skill(db_session, cleanup)
    r = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={"author": "alice", "body": "looks good"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    cleanup["comments"].append(uuid.UUID(body["id"]))
    assert body["author"] == "alice"
    assert body["body"] == "looks good"
    assert body["author_type"] == "human"
    assert body["comment_type"] is None
    assert body["rating"] is None
    assert body["linked_usage_id"] is None


def test_post_agent_comment_with_type_and_rating(client, db_session, cleanup):
    """Agent comment with comment_type + rating persists all fields."""
    skill = _seed_skill(db_session, cleanup)
    r = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={
            "author": "claude",
            "body": "found a corner case",
            "author_type": "agent",
            "comment_type": "agent_observation",
            "rating": 4,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    cleanup["comments"].append(uuid.UUID(body["id"]))
    assert body["author"] == "claude"
    assert body["author_type"] == "agent"
    assert body["comment_type"] == "agent_observation"
    assert body["rating"] == 4
    assert body["linked_usage_id"] is None


def test_post_agent_comment_without_type_422(client, db_session, cleanup):
    """Agent author_type without comment_type must be rejected (422)."""
    skill = _seed_skill(db_session, cleanup)
    r = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={"author": "claude", "body": "x", "author_type": "agent"},
    )
    assert r.status_code == 422, r.text
    err = r.json()["error"]
    # Schema validator fires first → VALIDATION_ENVELOPE; handler-side guard
    # would fire AGENT_COMMENT_REQUIRES_TYPE if the schema were relaxed.
    # Today only VALIDATION_ERROR fires (Pydantic catches first); AGENT_COMMENT_REQUIRES_TYPE
    # is the handler's defense-in-depth path, kept in the assertion for forward compatibility.
    assert err["code"] in {"VALIDATION_ERROR", "AGENT_COMMENT_REQUIRES_TYPE"}
    assert "comment_type" in err["message"]


def test_post_with_linked_usage_id_happy_path(client, db_session, cleanup):
    """linked_usage_id pointing at a real event is accepted and round-trips."""
    skill = _seed_skill(db_session, cleanup)
    event = _seed_usage_event(db_session, cleanup)
    r = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={
            "author": "claude",
            "body": "linked back to the run",
            "author_type": "agent",
            "comment_type": "agent_observation",
            "linked_usage_id": str(event.id),
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    cleanup["comments"].append(uuid.UUID(body["id"]))
    assert body["linked_usage_id"] == str(event.id)


def test_post_with_unknown_linked_usage_id_404(client, db_session, cleanup):
    """linked_usage_id pointing at a non-existent event yields 404."""
    skill = _seed_skill(db_session, cleanup)
    bogus = uuid.uuid4()
    r = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={
            "author": "claude",
            "body": "x",
            "author_type": "agent",
            "comment_type": "agent_observation",
            "linked_usage_id": str(bogus),
        },
    )
    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "LINKED_USAGE_NOT_FOUND"


def test_post_rating_out_of_range_422(client, db_session, cleanup):
    """rating > 5 must be rejected by the schema constraint (422)."""
    skill = _seed_skill(db_session, cleanup)
    r = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={
            "author": "claude",
            "body": "x",
            "author_type": "agent",
            "comment_type": "agent_observation",
            "rating": 10,
        },
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_get_returns_new_fields_for_agent_comment(client, db_session, cleanup):
    """GET surfaces the new fields populated by the agent POST."""
    skill = _seed_skill(db_session, cleanup)
    event = _seed_usage_event(db_session, cleanup)
    create = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={
            "author": "claude",
            "body": "agent body",
            "author_type": "agent",
            "comment_type": "agent_observation",
            "rating": 5,
            "linked_usage_id": str(event.id),
        },
    )
    assert create.status_code == 201, create.text
    cleanup["comments"].append(uuid.UUID(create.json()["id"]))

    r = client.get(f"/v1/skills/{skill.slug}/comments")
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["author_type"] == "agent"
    assert row["comment_type"] == "agent_observation"
    assert row["rating"] == 5
    assert row["linked_usage_id"] == str(event.id)


def test_get_returns_null_new_fields_for_legacy_human_comment(
    client, db_session, cleanup
):
    """A comment inserted via raw SQL with author_type='human' but no agent
    fields is read back with all the new agent-only fields nulled out.

    Migration 0015 dropped the server_default on author_type after backfilling
    existing rows, so brand-new inserts must supply it explicitly — but old
    rows (or rows that mimic the legacy API contract) still surface as
    author_type='human' with the agent-only fields untouched.
    """
    skill = _seed_skill(db_session, cleanup)
    comment_id = uuid.uuid4()
    db_session.execute(
        text(
            """
            INSERT INTO comments (id, skill_id, author, body, author_type, created_at, updated_at)
            VALUES (:id, :skill_id, :author, :body, 'human', :now, :now)
            """
        ),
        {
            "id": str(comment_id),
            "skill_id": str(skill.id),
            "author": "legacy-user",
            "body": "pre-extension comment",
            "now": datetime.now(timezone.utc),
        },
    )
    db_session.commit()
    cleanup["comments"].append(comment_id)

    r = client.get(f"/v1/skills/{skill.slug}/comments")
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["author"] == "legacy-user"
    assert row["author_type"] == "human"
    assert row["comment_type"] is None
    assert row["rating"] is None
    assert row["linked_usage_id"] is None


def test_update_only_body_unchanged_new_fields(client, db_session, cleanup):
    """PATCH updates body only; author_type/comment_type/rating must persist."""
    skill = _seed_skill(db_session, cleanup)
    create = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={
            "author": "claude",
            "body": "original",
            "author_type": "agent",
            "comment_type": "agent_observation",
            "rating": 3,
        },
    )
    assert create.status_code == 201, create.text
    comment_id = create.json()["id"]
    cleanup["comments"].append(uuid.UUID(comment_id))

    r = client.patch(
        f"/v1/skills/{skill.slug}/comments/{comment_id}",
        json={"body": "edited body"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["body"] == "edited body"
    # New fields untouched.
    assert body["author_type"] == "agent"
    assert body["comment_type"] == "agent_observation"
    assert body["rating"] == 3


def test_patch_silently_ignores_extra_agent_only_fields(client, db_session, cleanup):
    """PATCH must NOT accept rating/comment_type/etc. — CommentUpdate only declares body.

    Pydantic v2 strips unknown fields by default (extra='ignore' is the default). Verify
    the saved comment is unchanged on those fields even if a client tries to send them.
    """
    skill = _seed_skill(db_session, cleanup)
    # Seed an agent comment via API so we can compare round-trip
    create_resp = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={
            "author": "openclaw",
            "body": "original",
            "author_type": "agent",
            "comment_type": "agent_observation",
            "rating": 4,
        },
    )
    assert create_resp.status_code == 201
    comment_id = create_resp.json()["id"]
    cleanup["comments"].append(uuid.UUID(comment_id))

    # Try to update body AND extra agent-only fields
    patch_resp = client.patch(
        f"/v1/skills/{skill.slug}/comments/{comment_id}",
        json={
            "body": "updated",
            "rating": 1,
            "comment_type": "agent_issue",
            "author_type": "human",
        },
    )
    assert patch_resp.status_code == 200, patch_resp.text
    body = patch_resp.json()
    assert body["body"] == "updated"
    # The extra agent-only fields must be preserved from the original create
    assert body["rating"] == 4, "rating must not be patchable via comment update"
    assert body["comment_type"] == "agent_observation", "comment_type must not be patchable"
    assert body["author_type"] == "agent", "author_type must not be patchable"


# ── Bug fix tests (skill-in-event cross-check) ────────────────────────────


def test_post_agent_comment_linked_to_event_with_wrong_skill_422(
    client, db_session, cleanup
):
    """Agent comment on skill X linked to an event that only references skill Y
    must be rejected with 422 SKILL_NOT_IN_USAGE_EVENT.

    Bug: before the fix, the handler accepted any (skill, event) pair regardless
    of whether the event actually recorded that skill, allowing agents to
    accidentally corrupt skill ratings by cross-linking events.
    """
    skill_x = _seed_skill(db_session, cleanup)
    skill_y = _seed_skill(db_session, cleanup)
    # event only recorded skill_y
    event = _seed_usage_event(db_session, cleanup, skill_ids=[skill_y.id])

    r = client.post(
        f"/v1/skills/{skill_x.slug}/comments",
        json={
            "author": "claude",
            "body": "wrong skill link",
            "author_type": "agent",
            "comment_type": "agent_observation",
            "linked_usage_id": str(event.id),
        },
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "SKILL_NOT_IN_USAGE_EVENT"


def test_post_agent_comment_linked_to_event_with_empty_skill_ids_allowed(
    client, db_session, cleanup
):
    """When the linked event has an empty skill_ids list, the cross-check is
    skipped and the comment is accepted — the agent didn't record which skills
    it used, so we can't enforce membership.
    """
    skill = _seed_skill(db_session, cleanup)
    event = _seed_usage_event(db_session, cleanup, skill_ids=[])  # empty

    r = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={
            "author": "claude",
            "body": "no skills recorded in event",
            "author_type": "agent",
            "comment_type": "agent_observation",
            "linked_usage_id": str(event.id),
        },
    )
    assert r.status_code == 201, r.text
    cleanup["comments"].append(uuid.UUID(r.json()["id"]))


def test_post_agent_comment_linked_to_event_with_matching_skill_allowed(
    client, db_session, cleanup
):
    """Agent comment on skill X linked to an event that actually recorded
    skill X is accepted (the happy path for the cross-check).
    """
    skill = _seed_skill(db_session, cleanup)
    event = _seed_usage_event(db_session, cleanup, skill_ids=[skill.id])

    r = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={
            "author": "claude",
            "body": "skill was used in this event",
            "author_type": "agent",
            "comment_type": "agent_success_note",
            "rating": 5,
            "linked_usage_id": str(event.id),
        },
    )
    assert r.status_code == 201, r.text
    cleanup["comments"].append(uuid.UUID(r.json()["id"]))


# ── Bug fix: empty / whitespace body (Bug 5) ────────────────────────────


def test_post_comment_with_empty_body_422(client, db_session, cleanup):
    """POST with body='' must be rejected with a validation error."""
    skill = _seed_skill(db_session, cleanup)
    r = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={"author": "user", "body": ""},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_post_comment_with_whitespace_body_422(client, db_session, cleanup):
    """POST with body='   ' (whitespace only) must be rejected."""
    skill = _seed_skill(db_session, cleanup)
    r = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={"author": "user", "body": "   "},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_patch_comment_with_empty_body_422(client, db_session, cleanup):
    """PATCH with body='' must be rejected."""
    skill = _seed_skill(db_session, cleanup)
    comment = Comment(
        id=uuid.uuid4(),
        skill_id=skill.id,
        author="user",
        body="original",
    )
    db_session.add(comment)
    db_session.commit()
    cleanup["comments"].append(comment.id)

    r = client.patch(
        f"/v1/skills/{skill.slug}/comments/{comment.id}",
        json={"body": ""},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_patch_comment_with_whitespace_body_422(client, db_session, cleanup):
    """PATCH with body='\\t\\n' (whitespace only) must be rejected."""
    skill = _seed_skill(db_session, cleanup)
    comment = Comment(
        id=uuid.uuid4(),
        skill_id=skill.id,
        author="user",
        body="original",
    )
    db_session.add(comment)
    db_session.commit()
    cleanup["comments"].append(comment.id)

    r = client.patch(
        f"/v1/skills/{skill.slug}/comments/{comment.id}",
        json={"body": "\t\n"},
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


# ── Bug fix: human using agent-reserved comment_type (Bug 6) ────────────


def test_post_human_comment_with_agent_comment_type_422(client, db_session, cleanup):
    """Human comments must not be able to use agent_ prefixed comment types.

    Before the fix, a human could post with comment_type='agent_deprecation_warning'
    which would corrupt the staleness_status logic in context-bundle.
    """
    skill = _seed_skill(db_session, cleanup)
    r = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={
            "author": "human-user",
            "body": "looks outdated",
            "author_type": "human",
            "comment_type": "agent_deprecation_warning",
        },
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_post_agent_comment_type_allowed_for_agent_author(client, db_session, cleanup):
    """agent_ comment types are valid when author_type=agent (happy path)."""
    skill = _seed_skill(db_session, cleanup)
    r = client.post(
        f"/v1/skills/{skill.slug}/comments",
        json={
            "author": "claude",
            "body": "marked for review",
            "author_type": "agent",
            "comment_type": "agent_deprecation_warning",
        },
    )
    assert r.status_code == 201, r.text
    cleanup["comments"].append(uuid.UUID(r.json()["id"]))
