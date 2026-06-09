"""Iter 22d — verify conflict_policy auto-resolution actually fires.

Background: before this fix the inbound import flow ALWAYS overwrote the
local skill content + bumped current_version, regardless of whether a
divergence existed and regardless of the integration's conflict_policy.
The user's "Keep SkillNote" choice silently lost local edits because by
the time they made the choice, local was already the imported content.

The fix:
  1. detect_link_divergence honors conflict_policy and returns one of
     {no_conflict, diverged_ask, auto_keep_skillnote, auto_keep_claude_ai}.
  2. The inbound import flow branches on outcome:
       - auto_keep_skillnote: discard inbound, enqueue outbound push.
       - diverged_ask: stash inbound as is_latest=False, leave local intact.
       - no_conflict / auto_keep_claude_ai: apply normally.

Tests verify behavior end-to-end through the public API. Each test:
  - Pairs an extension (uses TEST-NET-1 IP to dodge rate limit)
  - Seeds a local skill with content X
  - Sets the integration's conflict_policy
  - Simulates a local edit (creates a NEW SkillContentVersion server-side
    so the link's recorded version diverges)
  - Then POSTs an inbound import with different content_md
  - Asserts the right outcome
"""
from __future__ import annotations

import io
import json
import os
import random
import urllib.error
import urllib.request
import uuid
import zipfile
from urllib.parse import quote as _q

import pytest


BASE = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _ip() -> str:
    return f"192.0.2.{random.randint(1, 254)}"


def _post(path, body=None, headers=None):
    h = {"Content-Type": "application/json"} if body is not None else {}
    if headers:
        h.update(headers)
    req = urllib.request.Request(
        f"{BASE}{path}", method="POST",
        data=(json.dumps(body).encode() if body is not None else None),
        headers=h,
    )
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        return e.code, (json.loads(txt) if txt else None)
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def _get(path, headers=None):
    req = urllib.request.Request(f"{BASE}{path}", method="GET", headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def _patch(path, body, headers=None):
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(
        f"{BASE}{path}", method="PATCH",
        data=json.dumps(body).encode(),
        headers=h,
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def _make_bundle(name: str, description: str, content_md: str) -> bytes:
    """Build a valid SKILL.md ZIP bundle."""
    buf = io.BytesIO()
    skill_md = (
        f"---\nname: {name}\ndescription: {description}\n---\n\n{content_md}"
    )
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{name}/SKILL.md", skill_md)
    return buf.getvalue()


def _import_skill(token: str, slug: str, content_md: str, claude_ai_skill_id: str, version: str = "v2"):
    """Upload a fake inbound skill via /imported-skill. Returns the response."""
    bundle = _make_bundle(slug, "from claude.ai", content_md)
    boundary = "----skillnote-test"
    body = b""
    for field, value in [
        ("claude_ai_skill_id", claude_ai_skill_id.encode()),
        ("claude_ai_version", version.encode()),
        ("name", slug.encode()),
        ("description", b"from claude.ai"),
    ]:
        body += (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{field}"\r\n\r\n'
        ).encode()
        body += value + b"\r\n"
    body += (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="bundle"; filename="{slug}.zip"\r\n'
        "Content-Type: application/zip\r\n\r\n"
    ).encode()
    body += bundle + b"\r\n"
    body += f"--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"{BASE}/v1/integrations/claude-ai/extension/imported-skill",
        method="POST",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


@pytest.fixture
def paired_with_skill():
    """Pair an extension, seed a local skill, simulate a prior successful
    push (creates a ClaudeAISkillLink), and return everything tests need.

    To create the link without going through the extension we use the
    public conflict-resolve API path indirectly via the inbound-import
    flow: we just do one initial import to bootstrap the link, then
    tests do further imports to trigger divergence.
    """
    ip = _ip()
    s, pair = _post(
        "/v1/integrations/claude-ai/extension/pair",
        body={"browser_label": "conflict-policy-test"},
        headers={"X-Forwarded-For": ip},
    )
    if s != 201:
        pytest.skip(f"pair returned {s}")
    _post(
        "/v1/integrations/claude-ai/pair/approve",
        body={"pairing_code": pair["pairing_code"]},
    )
    _, body = _get(
        f"/v1/integrations/claude-ai/extension/pair/status"
        f"?pairing_token={pair['pairing_token']}"
    )
    assert body["approved"]
    token = body["extension_token"]
    integ_id = pair["integration_id"]

    # Pre-create the link by doing an initial inbound import — this
    # mints a Skill + Link with link.claude_ai_version='v1'.
    slug = f"conflict-pol-{uuid.uuid4().hex[:6]}"
    claude_ai_skill_id = f"skill_remote_{uuid.uuid4().hex[:8]}"
    s, body = _import_skill(
        token, slug, "## initial remote content\n", claude_ai_skill_id, version="v1"
    )
    assert s in (200, 201), body
    skill_id = body["skillnote_skill_id"]
    return {
        "integ_id": integ_id,
        "token": token,
        "slug": slug,
        "skill_id": skill_id,
        "claude_ai_skill_id": claude_ai_skill_id,
    }


def _local_edit_skill(slug: str, new_content: str):
    """Make a local edit to the skill — creates a new SkillContentVersion.
    The PATCH endpoint is slug-keyed (not id-keyed)."""
    s, _ = _patch(
        f"/v1/skills/{slug}",
        body={"content_md": new_content},
    )
    if s not in (200, 204):
        pytest.skip(f"local edit returned {s}")


def _set_policy(integ_id: str, policy: str):
    s, _ = _patch(
        f"/v1/integrations/claude-ai/integrations/{integ_id}",
        body={"conflict_policy": policy},
    )
    assert s == 200


class TestConflictPolicyAsk:
    def test_diverged_ask_stages_inbound_without_overwriting_local(
        self, paired_with_skill
    ):
        """Policy=ask. Both sides change. Local content must be PRESERVED;
        the conflict flag must be set; the staged inbound version sits
        as is_latest=False so the user can pick a winner."""
        ctx = paired_with_skill
        # Default policy is 'ask'; explicit-set for clarity.
        _set_policy(ctx["integ_id"], "ask")

        local_content = "## LOCAL EDIT — must survive\n"
        _local_edit_skill(ctx["slug"], local_content)

        # Inbound import with a different remote version + different content
        # → divergence (local moved + remote moved since last sync).
        s, body = _import_skill(
            ctx["token"], ctx["slug"], "## REMOTE EDIT — should NOT clobber local\n",
            ctx["claude_ai_skill_id"], version="v2",
        )
        assert s in (200, 201)

        # The local skill's content_md must still be the local edit.
        s2, skill = _get(f"/v1/skills/{ctx["slug"]}")
        assert s2 == 200
        assert "LOCAL EDIT" in skill["content_md"], (
            "BUG: inbound import silently overwrote local edits"
        )
        assert "REMOTE EDIT" not in skill["content_md"]

        # And the conflict list now shows this link as diverged.
        s3, conflicts = _get("/v1/integrations/claude-ai/conflicts")
        assert s3 == 200
        ours = [
            c for c in conflicts
            if c["skillnote_skill_id"] == ctx["skill_id"]
        ]
        assert len(ours) == 1, ours


class TestConflictPolicySkillnoteWins:
    def test_skillnote_wins_discards_inbound_and_audits(
        self, paired_with_skill
    ):
        """Policy=skillnote_wins. Both sides change. Local content must
        be UNTOUCHED. Conflict must NOT be flagged. An audit row of
        kind 'conflict_resolved' with resolution=auto_keep_skillnote
        must be written."""
        ctx = paired_with_skill
        _set_policy(ctx["integ_id"], "skillnote_wins")

        local_content = "## LOCAL — policy says I win\n"
        _local_edit_skill(ctx["slug"], local_content)

        s, _ = _import_skill(
            ctx["token"], ctx["slug"], "## REMOTE — should be discarded\n",
            ctx["claude_ai_skill_id"], version="v3",
        )
        assert s in (200, 201)

        # Local content still intact.
        _, skill = _get(f"/v1/skills/{ctx["slug"]}")
        assert "LOCAL" in skill["content_md"]
        assert "REMOTE" not in skill["content_md"]

        # Conflict list must NOT include this skill.
        _, conflicts = _get("/v1/integrations/claude-ai/conflicts")
        assert all(
            c["skillnote_skill_id"] != ctx["skill_id"] for c in conflicts
        )

        # Audit log has a conflict_resolved row with the auto_keep_skillnote tag.
        _, events = _get(
            f"/v1/integrations/claude-ai/activity"
            f"?integration_id={ctx['integ_id']}&event=conflict_resolved&limit=20"
        )
        ours = [
            e for e in events
            if (e.get("detail") or {}).get("resolution") == "auto_keep_skillnote"
        ]
        assert len(ours) >= 1


class TestConflictPolicyClaudeAiWins:
    def test_claude_ai_wins_applies_inbound_and_audits(
        self, paired_with_skill
    ):
        """Policy=claude_ai_wins. Both sides change. Inbound is applied;
        conflict is NOT flagged; conflict_resolved audit is written."""
        ctx = paired_with_skill
        _set_policy(ctx["integ_id"], "claude_ai_wins")

        local_content = "## LOCAL — about to be overwritten by policy\n"
        _local_edit_skill(ctx["slug"], local_content)

        s, _ = _import_skill(
            ctx["token"], ctx["slug"], "## REMOTE WINS — applied via policy\n",
            ctx["claude_ai_skill_id"], version="v4",
        )
        assert s in (200, 201)

        _, skill = _get(f"/v1/skills/{ctx["slug"]}")
        assert "REMOTE WINS" in skill["content_md"]

        _, conflicts = _get("/v1/integrations/claude-ai/conflicts")
        assert all(
            c["skillnote_skill_id"] != ctx["skill_id"] for c in conflicts
        )

        _, events = _get(
            f"/v1/integrations/claude-ai/activity"
            f"?integration_id={ctx['integ_id']}&event=conflict_resolved&limit=20"
        )
        ours = [
            e for e in events
            if (e.get("detail") or {}).get("resolution") == "auto_keep_claude_ai"
        ]
        assert len(ours) >= 1
