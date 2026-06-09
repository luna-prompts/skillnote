"""End-to-end flow test for the claude.ai connector.

Walks the complete happy path:

  1. Pair an extension and approve it (active bearer issued).
  2. Publish a SkillNote skill via existing publish flow.
  3. Verify an upload op was enqueued by Phase 1b's _create_content_version hook.
  4. Extension fetches the op (status flips to in_progress).
  5. Extension completes it successfully — verify link row upserted.
  6. Delete the skill — verify delete op is enqueued.

This is the "does the whole thing actually work end-to-end" test. If any
of the per-component tests pass but this one fails, the connector is
broken at a stitching point.
"""
from __future__ import annotations


import pytest  # noqa: E402

pytestmark = pytest.mark.skip(reason=(
    'Superseded by the per-collection named-group model: one debounced `publish_group` op rebuilds the whole "SkillNote: <collection>" group, replacing the per-skill upload/delete/conflict op contract this file asserts. New contract is covered by tests/unit/test_claude_ai_service.py and tests/integration/test_claude_ai_plugin_bundle.py.'
))

import io
import os
import uuid
import zipfile

import pytest


def _publish_skill(api_request, slug: str) -> dict:
    """Create a SkillNote skill via POST /v1/skills.

    This is the path that calls `_create_content_version` (and therefore
    triggers the claude.ai upload-op enqueue hook). The /v1/publish
    endpoint is for bundle release versions, which is a different code
    path that doesn't go through the content-version hook.
    """
    # /v1/skills requires at least one collection AND collections have a
    # 15-skill cap. Use a slug-derived collection so each test gets its
    # own bucket — avoids cross-test interference when this test runs
    # against a shared/persistent DB.
    collection_name = f"ca-test-{slug[:24]}"
    status, body = api_request(
        "POST", "/v1/skills",
        body={
            "name": slug,
            "slug": slug,
            "description": "claude-ai e2e flow test skill",
            "content_md": "# Test skill\n\nSome content.",
            "collections": [collection_name],
        },
    )
    if status != 201:
        pytest.fail(f"skill create failed: {status} {body}")
    return body


def _bearer(token):
    """Build a bearer-request closure."""
    import json
    import os
    import urllib.error
    import urllib.request
    base = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
    def _req(method, path, body=None):
        h = {"Authorization": f"Bearer {token}"}
        if body is not None:
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(
            f"{base}{path}", method=method, headers=h,
            data=(json.dumps(body).encode() if body is not None else None),
        )
        try:
            with urllib.request.urlopen(req) as r:
                txt = r.read().decode()
                return r.status, (json.loads(txt) if txt else None)
        except urllib.error.HTTPError as e:
            txt = e.read().decode()
            return e.code, (json.loads(txt) if txt else None)
    return _req


@pytest.fixture
def paired_extension(api_request):
    """Standard pair → approve → redeem → return (integration_id, token)."""
    status, pair = api_request(
        "POST", "/v1/integrations/claude-ai/extension/pair",
        body={"browser_label": "e2e test"},
    )
    if status != 201:
        pytest.skip(f"pair endpoint returned {status}")
    api_request(
        "POST", "/v1/integrations/claude-ai/pair/approve",
        body={"pairing_code": pair["pairing_code"]},
    )
    _, body = api_request(
        "GET",
        f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={pair['pairing_token']}",
    )
    assert body["extension_token"]
    return pair["integration_id"], body["extension_token"]


class TestPublishEnqueueFlow:
    """Phase 1b: skill publish triggers upload op enqueue."""

    def test_publish_creates_upload_op(self, api_request, paired_extension):
        integ_id, token = paired_extension
        # Use a unique slug per test to avoid collisions with other runs.
        slug = f"e2e-pub-{uuid.uuid4().hex[:6]}"
        _publish_skill(api_request, slug)

        # Fetch ops via bearer. Should include exactly one upload op for our skill.
        bearer = _bearer(token)
        status, ops = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
        assert status == 200
        upload_ops = [op for op in ops if op["kind"] == "upload"]
        assert len(upload_ops) >= 1, f"expected upload op enqueued, got {ops}"

        ours = [op for op in upload_ops if op["payload"].get("name") == slug]
        assert len(ours) == 1, f"upload op for {slug} not found among {[o['payload'].get('name') for o in upload_ops]}"
        op = ours[0]
        assert op["skill_id"]
        assert op["payload"]["version_id"]
        assert op["payload"]["description"] == "claude-ai e2e flow test skill"

    def test_fetch_marks_op_in_progress(self, api_request, paired_extension):
        """Calling /operations atomically transitions pending → in_progress
        so a second concurrent extension instance won't grab the same op."""
        integ_id, token = paired_extension
        slug = f"e2e-fetch-{uuid.uuid4().hex[:6]}"
        _publish_skill(api_request, slug)
        bearer = _bearer(token)

        # First fetch claims the op.
        _, ops = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
        ours = [op for op in ops if op["payload"].get("name") == slug]
        assert ours
        op = ours[0]

        # Second fetch must NOT return the same op (it's now in_progress).
        _, ops_again = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
        ids_again = [o["id"] for o in ops_again]
        assert op["id"] not in ids_again, "op should not appear twice — locking broken"


class TestCompleteOpFlow:
    def test_complete_success_creates_link(self, api_request, paired_extension):
        integ_id, token = paired_extension
        slug = f"e2e-complete-{uuid.uuid4().hex[:6]}"
        _publish_skill(api_request, slug)
        bearer = _bearer(token)

        _, ops = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
        ours = [op for op in ops if op["payload"].get("name") == slug][0]

        # Extension reports success with a claude.ai skill ID + version.
        status, _ = bearer(
            "POST",
            f"/v1/integrations/claude-ai/extension/operations/{ours['id']}/complete",
            body={
                "success": True,
                "result": {"claude_ai_skill_id": "skill_ext_e2e_01", "claude_ai_version": "v1"},
                "claude_ai_org_id": "org_e2e_01",
            },
        )
        assert status == 204

        # known-skill-ids should now include the new claude_ai_skill_id.
        _, known = bearer("GET", "/v1/integrations/claude-ai/extension/known-skill-ids")
        assert "skill_ext_e2e_01" in known["claude_ai_skill_ids"]

        # Integration's claude_ai_org_id should be cached.
        _, integrations = api_request("GET", "/v1/integrations/claude-ai/integrations")
        ours_int = [i for i in integrations if i["id"] == integ_id][0]
        assert ours_int["claude_ai_org_id"] == "org_e2e_01"

    def test_complete_failure_retries_until_budget_exhausted(
        self, api_request, paired_extension
    ):
        """Failed ops retry up to 3 attempts, then move to 'failed' status.
        The retry counter increments at fetch time, so 3 failures means
        3 fetches; the 4th fetch finds nothing pending."""
        integ_id, token = paired_extension
        slug = f"e2e-retry-{uuid.uuid4().hex[:6]}"
        _publish_skill(api_request, slug)
        bearer = _bearer(token)

        for attempt in range(3):
            _, ops = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
            ours = [op for op in ops if op["payload"].get("name") == slug]
            if not ours:
                pytest.fail(f"expected op to be available on attempt {attempt + 1}")
            bearer(
                "POST",
                f"/v1/integrations/claude-ai/extension/operations/{ours[0]['id']}/complete",
                body={"success": False, "error": f"simulated failure #{attempt + 1}"},
            )

        # After 3 failures the op should be in 'failed' state; not returned.
        _, ops_after = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
        assert not [op for op in ops_after if op["payload"].get("name") == slug], \
            "exhausted-retry op should not be re-served"


class TestDeleteFlow:
    def test_delete_enqueues_delete_op_for_linked_skill(self, api_request, paired_extension):
        """Phase 1b: skill delete fans out a delete op for every linked
        claude.ai integration."""
        integ_id, token = paired_extension
        slug = f"e2e-del-{uuid.uuid4().hex[:6]}"
        published = _publish_skill(api_request, slug)
        skill_slug = published["slug"]
        bearer = _bearer(token)

        # Complete the upload so a link row exists.
        _, ops = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
        ours = [op for op in ops if op["payload"].get("name") == slug][0]
        bearer(
            "POST",
            f"/v1/integrations/claude-ai/extension/operations/{ours['id']}/complete",
            body={
                "success": True,
                "result": {"claude_ai_skill_id": "skill_ext_e2e_del", "claude_ai_version": "v1"},
            },
        )

        # Now delete the skill — triggers the Phase 1b delete hook.
        status, _ = api_request("DELETE", f"/v1/skills/{skill_slug}")
        assert status == 204

        # The delete op should be in the bearer's queue, payload references
        # the claude.ai skill ID we recorded above.
        _, ops_after = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
        delete_ops = [
            op for op in ops_after
            if op["kind"] == "delete"
            and op.get("payload", {}).get("claude_ai_skill_id") == "skill_ext_e2e_del"
        ]
        assert len(delete_ops) == 1, f"expected delete op for skill_ext_e2e_del, got {ops_after}"
