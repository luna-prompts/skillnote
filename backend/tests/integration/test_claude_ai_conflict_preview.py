"""Iter 20 — GET /conflicts/{link_id}/preview.

Side-by-side conflict preview. The endpoint returns:
  - last_pushed_* (the version we last successfully sent to claude.ai)
  - current_* (the SkillNote-side latest)
  - local_changed flag — True iff the local content diverged from
    what was last pushed (i.e. "Keep claude.ai" would overwrite real
    local edits)
  - claude.ai-side metadata (we never store the remote content here)

Contract:
  - Unknown link_id returns 404.
  - When the link has no skillnote_skill_id (inbound-only), the
    skillnote fields are all null but the endpoint still succeeds.
  - local_changed=False when current_version_id == last_pushed_version_id.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
import uuid

import pytest


BASE = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _get(path):
    req = urllib.request.Request(f"{BASE}{path}", method="GET")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:  # pragma: no cover
        pytest.skip(f"API not reachable: {e}")


class TestConflictPreview:
    def test_unknown_link_returns_404(self):
        s, body = _get(
            f"/v1/integrations/claude-ai/conflicts/{uuid.uuid4()}/preview"
        )
        assert s == 404
        assert body["error"]["code"] == "LINK_NOT_FOUND"

    def test_malformed_uuid_returns_422(self):
        s, _ = _get(
            "/v1/integrations/claude-ai/conflicts/not-a-uuid/preview"
        )
        assert s == 422

    def test_returns_full_shape_when_link_exists(self):
        # The conflict list endpoint returns any current links — pick the
        # first one if it exists, otherwise skip (no data to test against).
        s, conflicts = _get("/v1/integrations/claude-ai/conflicts")
        assert s == 200
        if not conflicts:
            pytest.skip("no conflicts in fixture data to preview")
        link_id = conflicts[0]["link_id"]
        s, body = _get(
            f"/v1/integrations/claude-ai/conflicts/{link_id}/preview"
        )
        assert s == 200, body
        # All required fields are present, with correct types.
        for k in [
            "link_id",
            "integration_id",
            "integration_label",
            "skill_id",
            "skill_slug",
            "skill_name",
            "last_pushed_version_id",
            "last_pushed_version_number",
            "last_pushed_content_md",
            "current_version_id",
            "current_version_number",
            "current_content_md",
            "local_changed",
            "claude_ai_skill_id",
            "claude_ai_version",
            "claude_ai_last_seen_at",
        ]:
            assert k in body, f"missing key {k}"
        assert isinstance(body["local_changed"], bool)
        assert body["link_id"] == link_id
