"""Integration tests for general skill-lifecycle notifications.

The activity feed graduated into a unified Notifications surface: creating,
updating, deleting, and restoring a skill each post an event to
claude_ai_audit_log. These kinds (skill_created/updated/deleted/restored) are
gated by a DB CHECK constraint (extended in migration 0028) — so if the
constraint were missing the value, the skill CRUD itself would 500. These tests
therefore double as an end-to-end guard on that migration.

Requires a running backend (override SKILLNOTE_TEST_BASE_URL). Skips if down.
"""
import json
import os
import urllib.error
import urllib.request
import uuid

import pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
ACTIVITY = "/v1/integrations/claude-ai/activity"


def _req(method, path, body=None):
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        method=method,
        headers={"Content-Type": "application/json"} if body else {},
        data=(json.dumps(body).encode() if body is not None else None),
    )
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode()
            return r.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        return e.code, (json.loads(text) if text else None)
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def _recent_events(slug: str, kinds: set[str], limit: int = 50):
    """Activity rows for `slug` (matched via skill_slug OR detail.slug) whose
    event is in `kinds`."""
    s, rows = _req("GET", f"{ACTIVITY}?limit={limit}")
    assert s == 200, rows
    out = []
    for e in rows:
        if e["event"] not in kinds:
            continue
        detail = e.get("detail") or {}
        if e.get("skill_slug") == slug or detail.get("slug") == slug:
            out.append(e)
    return out


@pytest.fixture
def skill():
    suffix = uuid.uuid4().hex[:8]
    slug = f"lifecycle-{suffix}"
    yield slug
    _req("DELETE", f"/v1/skills/{slug}")  # best-effort cleanup


def test_create_emits_skill_created(skill):
    s, _ = _req(
        "POST",
        "/v1/skills",
        {
            "name": skill,
            "slug": skill,
            "description": "Lifecycle activity test.",
            "content_md": "# x\n\nbody",
            "collections": ["conventions"],
        },
    )
    assert s == 201  # would be 500 if the CHECK rejected skill_created
    evts = _recent_events(skill, {"skill_created"})
    assert len(evts) >= 1
    assert evts[0]["detail"].get("slug") == skill


def test_update_emits_skill_updated(skill):
    _req(
        "POST",
        "/v1/skills",
        {
            "name": skill,
            "slug": skill,
            "description": "Initial.",
            "content_md": "# x\n\nbody",
            "collections": ["conventions"],
        },
    )
    s, _ = _req("PATCH", f"/v1/skills/{skill}", {"description": "Edited description."})
    assert s == 200
    evts = _recent_events(skill, {"skill_updated"})
    assert len(evts) >= 1


def test_delete_emits_skill_deleted_with_slug_in_detail(skill):
    _req(
        "POST",
        "/v1/skills",
        {
            "name": skill,
            "slug": skill,
            "description": "To be deleted.",
            "content_md": "# x\n\nbody",
            "collections": ["conventions"],
        },
    )
    s, _ = _req("DELETE", f"/v1/skills/{skill}")
    assert s == 204
    # The skill row is gone, so skill_slug can't resolve — the slug must live
    # in the event detail (that's how the feed still names a deleted skill).
    evts = _recent_events(skill, {"skill_deleted"})
    assert len(evts) >= 1
    assert evts[0]["detail"].get("slug") == skill


def test_activity_rejects_unknown_event_kind():
    """The event filter is whitelisted — a bogus kind is a 422, not a silent
    zero-match (guards against typos masking real data)."""
    s, _ = _req("GET", f"{ACTIVITY}?event=not_a_real_event_kind")
    assert s == 422
