"""Iter 29c — GET /skills/{slug}/sync-status.

The skill detail page surfaces "where is this skill synced and what's
its state on each integration." This endpoint joins ClaudeAISkillLink
to ClaudeAIIntegration and reports back a compact per-link summary
plus a pending-op counter.
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


def _patch(path, body):
    req = urllib.request.Request(
        f"{BASE}{path}", method="PATCH",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
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


def _bundle(name: str, content: str) -> bytes:
    buf = io.BytesIO()
    skill_md = f"---\nname: {name}\ndescription: from claude.ai\n---\n\n{content}"
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{name}/SKILL.md", skill_md)
    return buf.getvalue()


def _import_skill(token, slug, content, claude_id, version):
    bundle = _bundle(slug, content)
    boundary = "----skillnote-test"
    body = b""
    for field, value in [
        ("claude_ai_skill_id", claude_id.encode()),
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


class TestSkillSyncStatusBasics:
    def test_unknown_slug_returns_404(self):
        s, body = _get(
            "/v1/integrations/claude-ai/skills/this-skill-does-not-exist-xyz/sync-status"
        )
        assert s == 404
        assert body["error"]["code"] == "SKILL_NOT_FOUND"

    def test_slug_with_no_integrations_returns_empty_links(self):
        # Seed a skill that has never been touched by claude.ai.
        name = f"local-only-{uuid.uuid4().hex[:6]}"
        collection = f"l-{uuid.uuid4().hex[:8]}"
        s, _ = _post(
            "/v1/skills",
            body={
                "name": name, "slug": name,
                "description": "no claude.ai", "content_md": "# local\n",
                "collections": [collection],
            },
        )
        if s != 201:
            pytest.skip(f"skill seed returned {s}")
        s, body = _get(
            f"/v1/integrations/claude-ai/skills/{name}/sync-status"
        )
        assert s == 200, body
        assert body["skill_slug"] == name
        # links may be empty OR contain only outbound-pending rows from
        # the auto-enqueued upload op (no link exists until first
        # successful push completes).
        assert isinstance(body["links"], list)
        assert isinstance(body["claude_ai_sync_enabled"], bool)
        assert isinstance(body["pending_op_count"], int)


class TestToggleSyncBySlug:
    """The per-skill sync toggle must resolve a skill by slug, not just UUID —
    the offline-first frontend often holds a skill record without its backend
    UUID, so the badge passes the slug."""

    def test_toggle_resolves_by_slug_both_directions(self):
        name = f"toggle-slug-{uuid.uuid4().hex[:6]}"
        collection = f"t-{uuid.uuid4().hex[:8]}"
        s, _ = _post(
            "/v1/skills",
            body={
                "name": name, "slug": name,
                "description": "toggle test", "content_md": "# x\n",
                "collections": [collection],
            },
        )
        if s != 201:
            pytest.skip(f"skill seed returned {s}")

        # Toggle OFF by slug.
        s, _ = _patch(f"/v1/integrations/claude-ai/skills/{name}/sync", {"enabled": False})
        assert s == 204
        s, body = _get(f"/v1/integrations/claude-ai/skills/{name}/sync-status")
        assert s == 200 and body["claude_ai_sync_enabled"] is False

        # Toggle back ON by slug.
        s, _ = _patch(f"/v1/integrations/claude-ai/skills/{name}/sync", {"enabled": True})
        assert s == 204
        s, body = _get(f"/v1/integrations/claude-ai/skills/{name}/sync-status")
        assert s == 200 and body["claude_ai_sync_enabled"] is True

    def test_toggle_unknown_ref_returns_404(self):
        s, body = _patch(
            "/v1/integrations/claude-ai/skills/no-such-skill-xyz-123/sync",
            {"enabled": True},
        )
        assert s == 404
        assert body["error"]["code"] == "SKILL_NOT_FOUND"


class TestSkillSyncStatusWithLink:
    def test_imported_skill_surfaces_link_with_inbound_direction(self):
        # Pair an extension and import a skill — that mints a link.
        ip = _ip()
        s, pair = _post(
            "/v1/integrations/claude-ai/extension/pair",
            body={"browser_label": "sync-status-test"},
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

        slug = f"sync-stat-{uuid.uuid4().hex[:6]}"
        claude_id = f"skill_remote_{uuid.uuid4().hex[:8]}"
        s, _ = _import_skill(token, slug, "## from claude.ai\n", claude_id, "v1")
        assert s in (200, 201)

        # Now query sync-status on the new local slug.
        s, status = _get(
            f"/v1/integrations/claude-ai/skills/{slug}/sync-status"
        )
        assert s == 200, status
        assert status["skill_slug"] == slug
        assert len(status["links"]) == 1
        link = status["links"][0]
        assert link["integration_label"] == "sync-status-test"
        assert link["claude_ai_skill_id"] == claude_id
        assert link["claude_ai_version"] == "v1"
        assert link["direction"] in ("inbound", "both")
        # Status will be "active" since we just paired it.
        assert link["integration_status"] in ("active", "cookie_expired")
