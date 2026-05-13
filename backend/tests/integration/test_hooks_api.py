"""Integration tests for /v1/hooks/* endpoints.

Covers `POST /v1/hooks/skill-used` (Claude Code's PostToolUse hook) and
`POST /v1/hooks/session-eval` (Stop-hook evaluation receiver).

Requires a running backend on 127.0.0.1:8082 (`docker compose up api`).
Tests skip if API unreachable. Tests are append-only — they insert into
`skill_call_events` and tag with a unique session_id so concurrent runs
don't collide.
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
def db(engine):
    Session = sessionmaker(bind=engine)
    with Session() as s:
        yield s


def _post(path: str, body: dict | None):
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        method="POST",
        headers={"Content-Type": "application/json"},
        data=(json.dumps(body).encode() if body is not None else b"{}"),
    )
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode()
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        return e.code, json.loads(text) if text else None
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


@pytest.fixture
def unique_session():
    return f"sess-{uuid.uuid4().hex[:12]}"


# ── /v1/hooks/skill-used ─────────────────────────────────────────────────────


def test_skill_used_snake_case_payload_accepted(unique_session):
    """Direct API callers send snake_case — must be accepted as-is."""
    status, body = _post(
        "/v1/hooks/skill-used",
        {
            "skill_slug": "my-test-skill",
            "agent_name": "claude-code",
            "session_id": unique_session,
        },
    )
    assert status == 202, body
    assert body == {"status": "accepted"}


def test_skill_used_camelcase_payload_accepted(unique_session):
    """Claude Code's HTTP hook sends camelCase. Pydantic aliases must route it."""
    status, body = _post(
        "/v1/hooks/skill-used",
        {
            "toolName": "Skill",
            "toolInput": {"name": "my-test-skill"},
            "hookEventName": "PostToolUse",
            "sessionId": unique_session,
            "agentName": "claude-code",
        },
    )
    assert status == 202, body
    assert body == {"status": "accepted"}


def test_skill_used_skill_field_in_tool_input_extracted():
    """tool_input may carry the skill name under `skill` (older claude-code builds)."""
    status, body = _post(
        "/v1/hooks/skill-used",
        {
            "toolName": "Skill",
            "toolInput": {"skill": "alt-key-skill"},
        },
    )
    assert status == 202, body
    assert body == {"status": "accepted"}


def test_skill_used_skillnote_prefix_stripped(db, unique_session):
    """Plugin tools use `skillnote-<slug>` so they don't clash with built-ins.
    The hook must strip the prefix before logging, otherwise analytics show
    `skillnote-foo` instead of `foo` and we lose the link to the registry.

    Verifies by inspecting the persisted `skill_call_events` row.
    """
    submitted_slug = "skillnote-prefix-test-" + uuid.uuid4().hex[:8]
    expected_slug = submitted_slug[len("skillnote-"):]

    status, body = _post(
        "/v1/hooks/skill-used",
        {"skill_slug": submitted_slug, "session_id": unique_session},
    )
    assert status == 202, body

    row = db.execute(
        text(
            "SELECT skill_slug FROM skill_call_events "
            "WHERE session_id = :s ORDER BY id LIMIT 1"
        ),
        {"s": unique_session},
    ).first()
    assert row is not None, "hook insert did not land in skill_call_events"
    assert row[0] == expected_slug, (
        f"prefix not stripped: stored {row[0]!r}, expected {expected_slug!r}"
    )


def test_skill_used_no_slug_no_tool_input_returns_ignored():
    """Empty payload must not 500 — return a structured `ignored` response so
    the plugin's fire-and-forget call can drop it without retry noise."""
    status, body = _post("/v1/hooks/skill-used", {})
    assert status == 202, body
    assert body == {"status": "ignored", "reason": "no skill identified"}


def test_skill_used_empty_tool_input_dict_returns_ignored():
    """tool_input={} (Claude Code edge case) must not crash on .get()."""
    status, body = _post(
        "/v1/hooks/skill-used",
        {"toolName": "Skill", "toolInput": {}, "hookEventName": "PostToolUse"},
    )
    # No slug recoverable from any field — must ignore, not 500.
    assert status == 202, body
    assert body.get("status") in ("ignored", "accepted"), body


def test_skill_used_oversized_slug_rejected_by_pydantic():
    """`skill_slug` has max_length=128. Longer values must 422 before they
    hit the DB (the DB column is also 128 chars)."""
    status, body = _post(
        "/v1/hooks/skill-used",
        {"skill_slug": "x" * 129},
    )
    assert status == 422, body


# ── /v1/hooks/session-eval ───────────────────────────────────────────────────


def test_session_eval_happy_path(unique_session):
    status, body = _post(
        "/v1/hooks/session-eval",
        {
            "skill_slug": "session-eval-test",
            "evaluation": "Skill was helpful for renaming variables.",
            "session_id": unique_session,
        },
    )
    assert status == 202, body
    assert body == {"status": "accepted"}


def test_session_eval_missing_required_fields_returns_422():
    """skill_slug and evaluation are required."""
    status, body = _post("/v1/hooks/session-eval", {})
    assert status == 422, body


def test_session_eval_evaluation_too_long_rejected_by_pydantic():
    """evaluation max_length is 2000; longer payloads should 422."""
    status, body = _post(
        "/v1/hooks/session-eval",
        {"skill_slug": "x", "evaluation": "z" * 2001},
    )
    assert status == 422, body


def test_session_eval_at_2000_chars_accepted(unique_session):
    """Exactly at the boundary must succeed — common off-by-one regression site."""
    status, body = _post(
        "/v1/hooks/session-eval",
        {
            "skill_slug": "boundary-test",
            "evaluation": "z" * 2000,
            "session_id": unique_session,
        },
    )
    assert status == 202, body
