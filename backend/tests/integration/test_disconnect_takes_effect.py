"""Round 4 regression: clicking Disconnect must actually disconnect.

Before R4 the `_agent_status` derivation kept state="active" if there were
recent `skill_call_events` rows, regardless of whether the user had hit
Disconnect. That made the Disconnect button look broken — the agent
stayed in the Connected tab indefinitely.

The R4 fix: `delete_agent_installs` now writes an `agent_disconnects`
row, and `_agent_status` excludes activity events at-or-before that
timestamp via the `activity_floor` filter.

This test reproduces the exact sequence:
  1. Insert an `agent_installs` row + a recent `skill_call_events` row.
  2. Verify state is "active" (the pre-fix scenario).
  3. Hit DELETE /v1/setup/installs/claude-code.
  4. Verify state is now "pending" — proving the activity floor works.

Requires backend on 127.0.0.1:8082 and DB reachable.
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
    req = urllib.request.Request(f"{BASE_URL}{path}", method="GET")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def _delete(path: str):
    req = urllib.request.Request(f"{BASE_URL}{path}", method="DELETE")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
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
def db(engine):
    S = sessionmaker(bind=engine)
    with S() as s:
        yield s


def test_disconnect_overrides_recent_activity(db):
    """The user's primary complaint in R4: 'if someone disconnects it, is it
    actually showing or not on UI?' This test reproduces the exact backend
    pathology that made the UI lie."""
    agent = "claude-code"
    session_marker = f"r4-disc-{uuid.uuid4().hex[:8]}"

    # Capture and remove prior state so the test is self-contained.
    prior_installs = db.execute(
        text(
            "SELECT id, agent, machine_id_hash, installed_at, version "
            "FROM agent_installs WHERE agent = :agent"
        ),
        {"agent": agent},
    ).mappings().all()
    prior_disconnects = db.execute(
        text(
            "SELECT id, agent, disconnected_at "
            "FROM agent_disconnects WHERE agent = :agent"
        ),
        {"agent": agent},
    ).mappings().all()
    db.execute(text("DELETE FROM agent_installs WHERE agent = :a"), {"a": agent})
    db.execute(text("DELETE FROM agent_disconnects WHERE agent = :a"), {"a": agent})

    # Seed: agent IS installed AND has a very recent activity event.
    install_id = uuid.uuid4()
    db.execute(
        text(
            "INSERT INTO agent_installs "
            "(id, agent, machine_id_hash, installed_at, version) "
            "VALUES (:id, :agent, 'r4-test', now(), 'test')"
        ),
        {"id": str(install_id), "agent": agent},
    )
    db.execute(
        text(
            "INSERT INTO skill_call_events "
            "(id, skill_slug, event_type, agent_name, agent_version, "
            " session_id, collection_scope, remote_ip, created_at) "
            "VALUES (gen_random_uuid(), 'r4-test-skill', 'called', :agent, "
            " '', :session, NULL, 'r4-test', now())"
        ),
        {"agent": agent, "session": session_marker},
    )
    db.commit()

    try:
        # Pre-disconnect baseline: state should be active.
        status, body = _get("/v1/setup/agents")
        assert status == 200, body
        claude = next(r for r in body if r["agent"] == agent)
        assert claude["state"] == "active", f"baseline wrong: {claude}"
        assert claude["calls_24h"] >= 1

        # User clicks Disconnect.
        code = _delete(f"/v1/setup/installs/{agent}")
        assert code == 204

        # The user-visible bug pre-R4: state still "active" because of the
        # recent skill_call_event. Post-R4: state="pending" + calls_24h=0
        # because activity_floor filters the event out.
        status, body = _get("/v1/setup/agents")
        assert status == 200, body
        claude = next(r for r in body if r["agent"] == agent)
        assert claude["state"] == "pending", (
            f"Disconnect didn't take effect — state still {claude['state']}. "
            f"This means the activity_floor in _agent_status isn't filtering "
            f"pre-disconnect events."
        )
        assert claude["calls_24h"] == 0, (
            f"calls_24h should drop to 0 (pre-disconnect activity excluded); "
            f"got {claude['calls_24h']}"
        )
        assert claude["installed_at"] is None
    finally:
        db.execute(
            text("DELETE FROM skill_call_events WHERE session_id = :s"),
            {"s": session_marker},
        )
        db.execute(text("DELETE FROM agent_installs WHERE agent = :a"), {"a": agent})
        db.execute(text("DELETE FROM agent_disconnects WHERE agent = :a"), {"a": agent})
        # Restore prior state.
        for r in prior_installs:
            db.execute(
                text(
                    "INSERT INTO agent_installs "
                    "(id, agent, machine_id_hash, installed_at, version) "
                    "VALUES (:id, :agent, :hash, :ts, :v)"
                ),
                {
                    "id": str(r["id"]),
                    "agent": r["agent"],
                    "hash": r["machine_id_hash"],
                    "ts": r["installed_at"],
                    "v": r["version"],
                },
            )
        for r in prior_disconnects:
            db.execute(
                text(
                    "INSERT INTO agent_disconnects (id, agent, disconnected_at) "
                    "VALUES (:id, :agent, :ts)"
                ),
                {"id": str(r["id"]), "agent": r["agent"], "ts": r["disconnected_at"]},
            )
        db.commit()


def test_reinstall_after_disconnect_returns_to_active_AND_floor_still_filters(db):
    """After Disconnect → click Install again, state must return to 'active'
    AND the activity_floor must STILL filter pre-disconnect events from the
    24h/7d counts. This proves two invariants together:

      1. A fresh install dominates the state (installed_at != None wins).
      2. The disconnect tombstone keeps filtering OLD activity — so the
         counts reflect only post-install events, not stale pre-disconnect
         noise.

    Reviewer caught the prior version of this test: it had no pre-disconnect
    activity, so it passed even if `activity_floor` were broken.
    """
    agent = "claude-code"  # claude-code uses skill_call_events
    session_marker = f"r4-reinstall-{uuid.uuid4().hex[:8]}"

    prior_installs = db.execute(
        text(
            "SELECT id, agent, machine_id_hash, installed_at, version "
            "FROM agent_installs WHERE agent = :agent"
        ),
        {"agent": agent},
    ).mappings().all()
    prior_disconnects = db.execute(
        text(
            "SELECT id, agent, disconnected_at "
            "FROM agent_disconnects WHERE agent = :agent"
        ),
        {"agent": agent},
    ).mappings().all()
    db.execute(text("DELETE FROM agent_installs WHERE agent = :a"), {"a": agent})
    db.execute(text("DELETE FROM agent_disconnects WHERE agent = :a"), {"a": agent})
    db.commit()

    try:
        # PRE-DISCONNECT: seed an old install + recent activity event.
        db.execute(
            text(
                "INSERT INTO agent_installs "
                "(id, agent, machine_id_hash, installed_at, version) "
                "VALUES (gen_random_uuid(), :agent, 'r4-old', now(), 'old')"
            ),
            {"agent": agent},
        )
        db.execute(
            text(
                "INSERT INTO skill_call_events "
                "(id, skill_slug, event_type, agent_name, agent_version, "
                " session_id, collection_scope, remote_ip, created_at) "
                "VALUES (gen_random_uuid(), 'r4-old-skill', 'called', :agent, "
                " '', :session, NULL, 'r4-test', now())"
            ),
            {"agent": agent, "session": session_marker},
        )
        db.commit()

        # User disconnects.
        code = _delete(f"/v1/setup/installs/{agent}")
        assert code == 204

        status, body = _get("/v1/setup/agents")
        claude = next(r for r in body if r["agent"] == agent)
        assert claude["state"] == "pending", f"post-disconnect: {claude}"
        assert claude["calls_24h"] == 0, "pre-disconnect activity should be filtered"

        # User re-installs.
        ping = urllib.request.Request(
            f"{BASE_URL}/v1/setup/installs",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps(
                {"agent": agent, "machine_id_hash": "r4-new"}
            ).encode(),
        )
        with urllib.request.urlopen(ping) as r:
            assert r.status == 201

        status, body = _get("/v1/setup/agents")
        claude = next(r for r in body if r["agent"] == agent)
        assert claude["state"] == "active", (
            f"fresh install after disconnect should resurrect to active; "
            f"got {claude['state']}"
        )
        assert claude["installed_at"] is not None
        # CRITICAL: even though state is now active, the OLD activity event
        # from before the disconnect must STILL be filtered out. If this
        # assertion fails, the activity_floor was reset by the new install,
        # which would be wrong.
        assert claude["calls_24h"] == 0, (
            f"pre-disconnect event leaked into post-install counts: "
            f"calls_24h={claude['calls_24h']}. The activity_floor must "
            f"persist across re-installs."
        )
    finally:
        db.execute(
            text("DELETE FROM skill_call_events WHERE session_id = :s"),
            {"s": session_marker},
        )
        db.execute(text("DELETE FROM agent_installs WHERE agent = :a"), {"a": agent})
        db.execute(text("DELETE FROM agent_disconnects WHERE agent = :a"), {"a": agent})
        for r in prior_installs:
            db.execute(
                text(
                    "INSERT INTO agent_installs "
                    "(id, agent, machine_id_hash, installed_at, version) "
                    "VALUES (:id, :agent, :hash, :ts, :v)"
                ),
                {
                    "id": str(r["id"]),
                    "agent": r["agent"],
                    "hash": r["machine_id_hash"],
                    "ts": r["installed_at"],
                    "v": r["version"],
                },
            )
        for r in prior_disconnects:
            db.execute(
                text(
                    "INSERT INTO agent_disconnects (id, agent, disconnected_at) "
                    "VALUES (:id, :agent, :ts)"
                ),
                {"id": str(r["id"]), "agent": r["agent"], "ts": r["disconnected_at"]},
            )
        db.commit()
