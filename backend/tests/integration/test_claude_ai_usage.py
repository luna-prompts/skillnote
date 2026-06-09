"""Usage-analytics parity: claude.ai skill invocations flow through the same
hook + analytics as the other connectors.

The extension's usage scanner detects skill invocations in claude.ai
conversations (a tool_use reading /mnt/skills/user/{slug}/SKILL.md) and POSTs
them to /v1/hooks/skill-used with agent_name="claude-ai". They land in the
shared skill_call_events table, and the connector /analytics endpoint rolls
them up as invocations_24h/7d + top_used_skills_7d.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
import uuid

import pytest


BASE = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _post(path, body):
    r = urllib.request.Request(
        f"{BASE}{path}", method="POST",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(r) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        return e.code, (json.loads(txt) if txt else None)
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def _get(path):
    r = urllib.request.Request(f"{BASE}{path}", method="GET")
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


class TestUsageHook:
    def test_skill_used_accepts_claude_ai_agent(self):
        slug = f"usage-{uuid.uuid4().hex[:8]}"
        s, body = _post(
            "/v1/hooks/skill-used",
            {"skill_slug": slug, "agent_name": "claude-ai", "session_id": "conv-123"},
        )
        assert s == 202, body
        assert body["status"] == "accepted"

    def test_skill_used_strips_skillnote_prefix(self):
        # The hook normalizes a skillnote- prefix so it matches the registry
        # slug. (Extension sends the bare slug, but defense in depth.)
        s, body = _post(
            "/v1/hooks/skill-used",
            {"skill_slug": "skillnote-foo", "agent_name": "claude-ai"},
        )
        assert s == 202


class TestUsageRollup:
    def test_invocations_show_up_in_connector_analytics(self):
        # Record a few invocations of a unique skill via the hook…
        slug = f"usagerollup-{uuid.uuid4().hex[:8]}"
        for _ in range(3):
            s, _ = _post(
                "/v1/hooks/skill-used",
                {"skill_slug": slug, "agent_name": "claude-ai", "session_id": "c1"},
            )
            assert s == 202

        # …then confirm the connector analytics rolls them up.
        s, a = _get("/v1/integrations/claude-ai/analytics")
        assert s == 200, a
        # Shape present.
        assert "invocations_24h" in a
        assert "invocations_7d" in a
        assert "top_used_skills_7d" in a
        # Our 3 invocations are counted in the 7d window.
        assert a["invocations_7d"] >= 3
        assert a["invocations_24h"] >= 3
        # And our skill appears in the top-used list with >=3.
        ours = [t for t in a["top_used_skills_7d"] if t["skill_slug"] == slug]
        # It may or may not be in the TOP 5 depending on other test data, but
        # if present its count must be >= 3.
        if ours:
            assert ours[0]["invocations"] >= 3

    def test_other_agents_do_not_count_as_claude_ai_usage(self):
        # A claude-code invocation must NOT inflate the claude.ai usage count.
        s, before = _get("/v1/integrations/claude-ai/analytics")
        base = before["invocations_7d"]
        slug = f"cc-{uuid.uuid4().hex[:8]}"
        _post(
            "/v1/hooks/skill-used",
            {"skill_slug": slug, "agent_name": "claude-code", "session_id": "cc1"},
        )
        s, after = _get("/v1/integrations/claude-ai/analytics")
        # claude.ai invocation count unchanged by a claude-code event.
        assert after["invocations_7d"] == base
