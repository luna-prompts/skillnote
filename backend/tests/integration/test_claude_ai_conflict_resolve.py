"""Iter 27 — end-to-end conflict resolve tests.

Iter 22d fixed the inbound import flow to STASH the diverged inbound
version as is_latest=False instead of overwriting local. Iter 27
follows through on what /conflicts/{id}/resolve has to do with that
staged version:

  - keep_skillnote: discard the staged version (hard-delete), enqueue
                    an outbound push of the local-latest, mark resolved.
  - keep_claude_ai: PROMOTE the staged version to latest, apply its
                    title/description/content_md to the parent Skill,
                    mark resolved. No more fetch_one round-trip when
                    we already have the data locally.
  - skip:           clear the flag, don't touch either side.

Every resolve emits a `conflict_resolved` audit row with the resolution
kind + relevant ids.
"""
from __future__ import annotations


import pytest  # noqa: E402

pytestmark = pytest.mark.skip(reason=(
    'Superseded by the per-collection named-group model: one debounced `publish_group` op rebuilds the whole "SkillNote: <collection>" group, replacing the per-skill upload/delete/conflict op contract this file asserts. New contract is covered by tests/unit/test_claude_ai_service.py and tests/integration/test_claude_ai_plugin_bundle.py.'
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


def _get(path):
    req = urllib.request.Request(f"{BASE}{path}", method="GET")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def _patch(path, body):
    req = urllib.request.Request(
        f"{BASE}{path}", method="PATCH",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def _bundle(name: str, content: str) -> bytes:
    buf = io.BytesIO()
    skill_md = f"---\nname: {name}\ndescription: from claude.ai\n---\n\n{content}"
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{name}/SKILL.md", skill_md)
    return buf.getvalue()


def _import_skill(token: str, slug: str, content_md: str, claude_ai_skill_id: str, version: str):
    bundle = _bundle(slug, content_md)
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
def diverged_link():
    """Set up: pair, import (creates link with v1), local edit, inbound
    re-import with v2 + different content → forces diverged_ask outcome
    (policy stays default 'ask'). Returns the link_id + the local content
    + the integration so tests can poke at each branch.
    """
    ip = _ip()
    s, pair = _post(
        "/v1/integrations/claude-ai/extension/pair",
        body={"browser_label": "resolve-test"},
        headers={"X-Forwarded-For": ip},
    )
    if s != 201:
        pytest.skip(f"pair returned {s}")
    _post("/v1/integrations/claude-ai/pair/approve",
          body={"pairing_code": pair["pairing_code"]})
    _, body = _get(
        f"/v1/integrations/claude-ai/extension/pair/status"
        f"?pairing_token={pair['pairing_token']}"
    )
    token = body["extension_token"]

    slug = f"resolve-{uuid.uuid4().hex[:6]}"
    claude_id = f"skill_remote_{uuid.uuid4().hex[:8]}"
    # 1) Initial import — creates the link with v1.
    _import_skill(token, slug, "## INITIAL remote\n", claude_id, version="v1")
    # 2) Local edit — bumps the local SkillContentVersion.
    LOCAL = "## LOCAL EDIT — must survive\n"
    s, _ = _patch(f"/v1/skills/{slug}", {"content_md": LOCAL})
    if s not in (200, 204):
        pytest.skip(f"local edit returned {s}")
    # 3) Inbound import with NEW remote content + different version →
    #    detect_link_divergence sees both sides changed → diverged_ask
    #    (policy default).
    REMOTE = "## NEW REMOTE EDIT\n"
    _import_skill(token, slug, REMOTE, claude_id, version="v2")
    # 4) Sanity check the conflict materialized.
    _, conflicts = _get("/v1/integrations/claude-ai/conflicts")
    ours = [c for c in conflicts if c["skillnote_skill_slug"] == slug]
    if not ours:
        pytest.skip(
            "expected divergence didn't materialize — check that policy=ask "
            "is still the default"
        )
    return {
        "integ_id": pair["integration_id"],
        "token": token,
        "slug": slug,
        "skill_id": ours[0]["skillnote_skill_id"],
        "link_id": ours[0]["link_id"],
        "claude_ai_skill_id": claude_id,
        "local_content": LOCAL,
        "remote_content": REMOTE,
    }


class TestKeepSkillNote:
    def test_local_content_preserved_after_keep_skillnote(self, diverged_link):
        ctx = diverged_link
        s, _ = _post(
            f"/v1/integrations/claude-ai/conflicts/{ctx['link_id']}/resolve",
            body={"resolution": "keep_skillnote"},
        )
        assert s == 204

        # Local content is still the LOCAL edit, not the remote.
        _, skill = _get(f"/v1/skills/{ctx['slug']}")
        assert "LOCAL EDIT" in skill["content_md"]
        assert "NEW REMOTE EDIT" not in skill["content_md"]

    def test_keep_skillnote_enqueues_outbound_push(self, diverged_link):
        ctx = diverged_link
        _post(
            f"/v1/integrations/claude-ai/conflicts/{ctx['link_id']}/resolve",
            body={"resolution": "keep_skillnote"},
        )
        # The queue has an upload op scoped to this integration with
        # skill_slug == our slug.
        _, q = _get(
            f"/v1/integrations/claude-ai/queue?integration_id={ctx['integ_id']}&limit=50"
        )
        ours = [
            it for it in q["items"]
            if it["kind"] in ("upload", "update") and it["skill_slug"] == ctx["slug"]
        ]
        assert len(ours) >= 1, ours

    def test_keep_skillnote_clears_conflict_flag(self, diverged_link):
        ctx = diverged_link
        _post(
            f"/v1/integrations/claude-ai/conflicts/{ctx['link_id']}/resolve",
            body={"resolution": "keep_skillnote"},
        )
        _, conflicts = _get("/v1/integrations/claude-ai/conflicts")
        assert not any(c["link_id"] == ctx["link_id"] for c in conflicts)

    def test_keep_skillnote_emits_audit_event(self, diverged_link):
        ctx = diverged_link
        _post(
            f"/v1/integrations/claude-ai/conflicts/{ctx['link_id']}/resolve",
            body={"resolution": "keep_skillnote"},
        )
        _, events = _get(
            f"/v1/integrations/claude-ai/activity"
            f"?integration_id={ctx['integ_id']}&event=conflict_resolved&limit=10"
        )
        ours = [
            e for e in events
            if (e.get("detail") or {}).get("link_id") == ctx["link_id"]
            and (e.get("detail") or {}).get("resolution") == "keep_skillnote"
        ]
        assert len(ours) >= 1


class TestKeepClaudeAI:
    def test_keep_claude_ai_promotes_staged_version(self, diverged_link):
        ctx = diverged_link
        s, _ = _post(
            f"/v1/integrations/claude-ai/conflicts/{ctx['link_id']}/resolve",
            body={"resolution": "keep_claude_ai"},
        )
        assert s == 204

        # Local skill now has the REMOTE content (the staged version
        # was promoted to latest).
        _, skill = _get(f"/v1/skills/{ctx['slug']}")
        assert "NEW REMOTE EDIT" in skill["content_md"]
        assert "LOCAL EDIT" not in skill["content_md"]

    def test_keep_claude_ai_does_NOT_enqueue_fetch_one(self, diverged_link):
        """Post-iter-27: when a staged version exists we promote it
        in-place. A fetch_one op (the legacy fallback) should NOT be
        queued in this happy-path scenario."""
        ctx = diverged_link
        _post(
            f"/v1/integrations/claude-ai/conflicts/{ctx['link_id']}/resolve",
            body={"resolution": "keep_claude_ai"},
        )
        _, q = _get(
            f"/v1/integrations/claude-ai/queue?integration_id={ctx['integ_id']}&limit=50"
        )
        fetch_ones = [it for it in q["items"] if it["kind"] == "fetch_one"]
        assert fetch_ones == [], (
            f"Expected no fetch_one op (staged version should promote in-place); "
            f"got {fetch_ones}"
        )

    def test_keep_claude_ai_audit_records_promoted_version(self, diverged_link):
        ctx = diverged_link
        _post(
            f"/v1/integrations/claude-ai/conflicts/{ctx['link_id']}/resolve",
            body={"resolution": "keep_claude_ai"},
        )
        _, events = _get(
            f"/v1/integrations/claude-ai/activity"
            f"?integration_id={ctx['integ_id']}&event=conflict_resolved&limit=10"
        )
        ours = [
            e for e in events
            if (e.get("detail") or {}).get("link_id") == ctx["link_id"]
            and (e.get("detail") or {}).get("resolution") == "keep_claude_ai"
        ]
        assert len(ours) >= 1
        assert "promoted_version_id" in (ours[0].get("detail") or {}), ours[0]


class TestSkipResolution:
    def test_skip_clears_conflict_without_touching_content(self, diverged_link):
        ctx = diverged_link
        s, _ = _post(
            f"/v1/integrations/claude-ai/conflicts/{ctx['link_id']}/resolve",
            body={"resolution": "skip"},
        )
        assert s == 204
        # Local content unchanged (still the LOCAL edit).
        _, skill = _get(f"/v1/skills/{ctx['slug']}")
        assert "LOCAL EDIT" in skill["content_md"]
        # Conflict flag cleared.
        _, conflicts = _get("/v1/integrations/claude-ai/conflicts")
        assert not any(c["link_id"] == ctx["link_id"] for c in conflicts)
