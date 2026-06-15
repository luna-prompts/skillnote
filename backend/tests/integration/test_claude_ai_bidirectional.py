"""Rigorous bidirectional sync tests — the update paths in both directions.

These prove, at the public-API boundary (everything except the actual
claude.ai HTTP call, which the extension makes in-browser):

  FORWARD  (SkillNote -> claude.ai):
    create -> upload op -> link forms
    EDIT   -> a NEW upload op is enqueued carrying the NEW version
    complete -> link's version advances

  REVERSE  (claude.ai -> SkillNote), remote-only change:
    a re-import with a newer claude_ai_version but unchanged local side
    applies cleanly (no conflict) and updates the local content.

  COALESCING:
    rapid edits don't pile up duplicate pending upload ops — the pending
    op's payload is rewritten to the latest version instead.
"""
from __future__ import annotations


import pytest  # noqa: E402

pytestmark = pytest.mark.skip(reason=(
    'Superseded by the per-collection named-group model (one publish_group op rebuilds the whole group). Per-skill forward-update/coalescing contract is covered by tests/unit/test_claude_ai_service.py and tests/integration/test_claude_ai_plugin_bundle.py.'
))

import io
import json
import os
import random
import urllib.error
import urllib.request
import uuid
import zipfile

import pytest


BASE = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _ip() -> str:
    return f"192.0.2.{random.randint(1, 254)}"


def _req(method, path, body=None, headers=None, raw=False):
    h = {}
    if body is not None and not raw:
        h["Content-Type"] = "application/json"
    if headers:
        h.update(headers)
    data = None
    if body is not None:
        data = body if raw else json.dumps(body).encode()
    r = urllib.request.Request(f"{BASE}{path}", method=method, data=data, headers=h)
    try:
        with urllib.request.urlopen(r) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, txt
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def _pair():
    s, pair = _req(
        "POST", "/v1/integrations/claude-ai/extension/pair",
        body={"browser_label": "bidi-test"},
        headers={"X-Forwarded-For": _ip()},
    )
    if s != 201:
        pytest.skip(f"pair returned {s}")
    _req("POST", "/v1/integrations/claude-ai/pair/approve",
         body={"pairing_code": pair["pairing_code"]})
    s, st = _req(
        "GET",
        f"/v1/integrations/claude-ai/extension/pair/status?pairing_token={pair['pairing_token']}",
    )
    assert st["approved"]
    return pair["integration_id"], st["extension_token"]


def _bearer_get_ops(token):
    return _req("GET", "/v1/integrations/claude-ai/extension/operations?limit=20",
                headers={"Authorization": f"Bearer {token}"})


def _complete(token, op_id, body):
    return _req(
        "POST", f"/v1/integrations/claude-ai/extension/operations/{op_id}/complete",
        body=body, headers={"Authorization": f"Bearer {token}"},
    )


def _create_skill(name, content="# v1\n"):
    return _req("POST", "/v1/skills", body={
        "name": name, "slug": name, "description": "bidi original",
        "content_md": content, "collections": [f"bidi-{uuid.uuid4().hex[:8]}"],
    })


def _edit_skill(slug, content):
    return _req("PATCH", f"/v1/skills/{slug}", body={"content_md": content})


def _import(token, slug, content, claude_id, version):
    """Simulate a claude.ai -> SkillNote inbound import via the extension."""
    buf = io.BytesIO()
    skill_md = f"---\nname: {slug}\ndescription: from claude.ai\n---\n\n{content}"
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{slug}/SKILL.md", skill_md)
    boundary = "----bidi"
    body = b""
    for f, v in [
        ("claude_ai_skill_id", claude_id.encode()),
        ("claude_ai_version", version.encode()),
        ("name", slug.encode()),
        ("description", b"from claude.ai"),
    ]:
        body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{f}\"\r\n\r\n").encode() + v + b"\r\n"
    body += (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"bundle\"; "
        f"filename=\"{slug}.zip\"\r\nContent-Type: application/zip\r\n\r\n"
    ).encode() + buf.getvalue() + b"\r\n" + f"--{boundary}--\r\n".encode()
    return _req(
        "POST", "/v1/integrations/claude-ai/extension/imported-skill",
        body=body, raw=True,
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": f"multipart/form-data; boundary={boundary}"},
    )


class TestForwardUpdate:
    def test_edit_enqueues_new_upload_op_with_new_version(self):
        integ_id, token = _pair()
        name = f"fwd-{uuid.uuid4().hex[:6]}"
        s, created = _create_skill(name)
        assert s == 201, created

        # Extension pulls + completes the first upload → link forms at v1.
        s, ops = _bearer_get_ops(token)
        first = next((o for o in ops if o.get("payload", {}).get("name") == name), None)
        assert first is not None, "create should enqueue an upload op"
        v1_version_id = first["payload"]["version_id"]
        claude_id = f"skill_{uuid.uuid4().hex[:10]}"
        s, _ = _complete(token, first["id"], {
            "success": True,
            "result": {"claude_ai_skill_id": claude_id, "claude_ai_version": "v1"},
        })
        assert s == 204

        # EDIT the skill — must enqueue a fresh upload op with a NEW version_id.
        s, _ = _edit_skill(name, "# v2 EDITED\n")
        assert s in (200, 204)
        s, ops2 = _bearer_get_ops(token)
        edit_op = next((o for o in ops2 if o.get("payload", {}).get("name") == name), None)
        assert edit_op is not None, "edit must enqueue an upload op"
        assert edit_op["payload"]["version_id"] != v1_version_id, (
            "the edit op must carry the NEW version, not the stale v1"
        )

    def test_completing_edit_advances_link_version(self):
        integ_id, token = _pair()
        name = f"fwd2-{uuid.uuid4().hex[:6]}"
        _create_skill(name)
        s, ops = _bearer_get_ops(token)
        op = next(o for o in ops if o.get("payload", {}).get("name") == name)
        claude_id = f"skill_{uuid.uuid4().hex[:10]}"
        _complete(token, op["id"], {"success": True,
                  "result": {"claude_ai_skill_id": claude_id, "claude_ai_version": "v1"}})

        # Edit + complete with v2.
        _edit_skill(name, "# v2\n")
        s, ops2 = _bearer_get_ops(token)
        op2 = next(o for o in ops2 if o.get("payload", {}).get("name") == name)
        _complete(token, op2["id"], {"success": True,
                  "result": {"claude_ai_skill_id": claude_id, "claude_ai_version": "v2"}})

        # The per-skill sync-status should now show the link at v2.
        s, status = _req("GET", f"/v1/integrations/claude-ai/skills/{name}/sync-status")
        assert s == 200
        ours = [l for l in status["links"] if l["claude_ai_skill_id"] == claude_id]
        assert len(ours) == 1
        assert ours[0]["claude_ai_version"] == "v2", ours


class TestCoalescing:
    def test_rapid_edits_do_not_pile_up_pending_ops(self):
        integ_id, token = _pair()
        name = f"coal-{uuid.uuid4().hex[:6]}"
        _create_skill(name)
        # Three rapid edits WITHOUT the extension draining in between.
        _edit_skill(name, "# e1\n")
        _edit_skill(name, "# e2\n")
        _edit_skill(name, "# e3\n")
        # Only ONE pending upload op should exist for this skill+integration.
        s, q = _req("GET", f"/v1/integrations/claude-ai/queue?integration_id={integ_id}&limit=50")
        ours = [it for it in q["items"] if it["skill_slug"] == name and it["kind"] == "upload"]
        assert len(ours) == 1, f"rapid edits should coalesce to 1 op, got {len(ours)}"


class TestReverseUpdate:
    def test_remote_only_change_updates_local_without_conflict(self):
        integ_id, token = _pair()
        name = f"rev-{uuid.uuid4().hex[:6]}"
        claude_id = f"skill_{uuid.uuid4().hex[:10]}"

        # Initial inbound import creates the local skill + link at v1.
        s, body = _import(token, name, "## remote v1\n", claude_id, "v1")
        assert s in (200, 201), body

        # Remote edits again (v2). Local was NOT touched since v1 → only the
        # remote side changed → applies cleanly, no conflict.
        s, body = _import(token, name, "## remote v2 UPDATED\n", claude_id, "v2")
        assert s in (200, 201), body

        # Local content now reflects the v2 import.
        s, skill = _req("GET", f"/v1/skills/{name}")
        assert s == 200
        assert "remote v2 UPDATED" in skill["content_md"]

        # And it is NOT flagged as a conflict (only one side changed).
        s, conflicts = _req("GET", "/v1/integrations/claude-ai/conflicts")
        assert not any(c["skillnote_skill_slug"] == name for c in conflicts)
