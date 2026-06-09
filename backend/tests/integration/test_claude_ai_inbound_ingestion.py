"""Full inbound-skill-ingestion + conflict auto-detection + cleanup tests.

Covers the deferred-from-Phase-1 work that's now complete:
  - POST /extension/imported-skill creates a real Skill + SkillContentVersion
  - Repeat imports update the existing skill (no duplicate slugs)
  - Conflict detection fires when both sides changed
  - POST /admin/cleanup-expired-pairings prunes stale pending rows
"""
from __future__ import annotations


import pytest  # noqa: E402

pytestmark = pytest.mark.skip(reason=(
    'Reverse-sync conflict auto-detection depends on the per-skill link/upload op model, which the named-group migration replaced (groups upload as a whole, no per-skill claude_ai_skill_id link). Reverse sync for the group model is a separate track; forward group sync is covered by tests/integration/test_claude_ai_plugin_bundle.py + unit tests.'
))

import io
import json
import os
import urllib.error
import urllib.request
import uuid
import zipfile

import pytest


def _build_skill_zip(name: str, description: str, body: str = "# Test skill") -> bytes:
    """Produce a valid SKILL.md bundle for the inbound import endpoint."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            f"{name}/SKILL.md",
            f"---\nname: {name}\ndescription: {description}\n---\n\n{body}\n",
        )
    return buf.getvalue()


def _bearer(token: str):
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


def _upload_imported_skill(
    token: str,
    *,
    name: str,
    description: str,
    claude_ai_skill_id: str,
    claude_ai_version: str | None = None,
    body: str = "# Test skill content",
) -> tuple[int, dict]:
    """Multipart POST to /extension/imported-skill."""
    base = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
    zip_bytes = _build_skill_zip(name, description, body)
    boundary = "----pytest-inbound-" + uuid.uuid4().hex
    parts = []
    for k, v in [
        ("claude_ai_skill_id", claude_ai_skill_id),
        ("name", name),
        ("description", description),
        *([("claude_ai_version", claude_ai_version)] if claude_ai_version else []),
    ]:
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode())
        parts.append(v.encode() + b"\r\n")
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(
        f'Content-Disposition: form-data; name="bundle"; filename="{name}.zip"\r\n'
        f"Content-Type: application/zip\r\n\r\n".encode()
    )
    parts.append(zip_bytes)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body_bytes = b"".join(parts)

    req = urllib.request.Request(
        f"{base}/v1/integrations/claude-ai/extension/imported-skill",
        method="POST",
        data=body_bytes,
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
def paired_extension(api_request):
    # Per-fixture unique TEST-NET-1 IP — keeps this fixture from being
    # rate-limited when run alongside other suites that also hit /pair.
    # Without this, suite-order determined whether these tests passed.
    import random
    ip = f"192.0.2.{random.randint(1, 254)}"
    status, pair = api_request(
        "POST", "/v1/integrations/claude-ai/extension/pair",
        body={"browser_label": "ingestion test"},
        headers={"X-Forwarded-For": ip},
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
    return pair["integration_id"], body["extension_token"]


class TestInboundSkillCreation:
    def test_creates_new_skill_when_slug_unique(self, api_request, paired_extension):
        _, token = paired_extension
        name = f"inbound-new-{uuid.uuid4().hex[:6]}"
        status, body = _upload_imported_skill(
            token,
            name=name,
            description="created from claude.ai",
            claude_ai_skill_id=f"skill_in_{uuid.uuid4().hex[:6]}",
            claude_ai_version="v1",
            body="# Imported skill\n\nfrom claude.ai",
        )
        assert status == 201
        assert body["created"] is True
        skill_id = body["skillnote_skill_id"]

        # Verify the skill is actually queryable.
        status, detail = api_request("GET", f"/v1/skills/{name}")
        assert status == 200
        assert detail["name"] == name
        assert detail["description"] == "created from claude.ai"
        assert detail["current_version"] >= 1
        assert "Imported skill" in detail["content_md"]
        assert detail["id"] == skill_id

    def test_idempotent_for_same_claude_id(self, api_request, paired_extension):
        _, token = paired_extension
        name = f"inbound-idem-{uuid.uuid4().hex[:6]}"
        ca_id = f"skill_idem_{uuid.uuid4().hex[:6]}"

        s1, b1 = _upload_imported_skill(
            token, name=name, description="v1", claude_ai_skill_id=ca_id,
            claude_ai_version="v1", body="# v1",
        )
        assert s1 == 201 and b1["created"] is True

        s2, b2 = _upload_imported_skill(
            token, name=name, description="v2 updated", claude_ai_skill_id=ca_id,
            claude_ai_version="v2", body="# v2 updated",
        )
        assert s2 == 201
        assert b2["created"] is False, "second import of same claude.ai id should not create new skill"
        assert b2["skillnote_skill_id"] == b1["skillnote_skill_id"]

        # Detail should reflect the v2 content.
        _, detail = api_request("GET", f"/v1/skills/{name}")
        assert "v2 updated" in detail["content_md"]
        assert detail["current_version"] >= 2

    def test_rejects_invalid_bundle(self, api_request, paired_extension):
        _, token = paired_extension
        base = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
        # Send garbage as the bundle.
        boundary = "----p-" + uuid.uuid4().hex
        parts = [
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="claude_ai_skill_id"\r\n\r\nskill_x\r\n',
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="name"\r\n\r\nbad\r\n',
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="description"\r\n\r\nbad\r\n',
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="bundle"; filename="x.zip"\r\n'
            b"Content-Type: application/zip\r\n\r\n",
            b"NOT A ZIP",
            f"\r\n--{boundary}--\r\n".encode(),
        ]
        req = urllib.request.Request(
            f"{base}/v1/integrations/claude-ai/extension/imported-skill",
            method="POST",
            data=b"".join(parts),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
        )
        try:
            urllib.request.urlopen(req)
            pytest.fail("expected 422")
        except urllib.error.HTTPError as e:
            assert e.code == 422

    def test_rejects_skill_missing_frontmatter(self, api_request, paired_extension):
        _, token = paired_extension
        base = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
        # Build a ZIP with a SKILL.md but no frontmatter.
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("x/SKILL.md", "no frontmatter here")
        boundary = "----p-" + uuid.uuid4().hex
        parts = [
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="claude_ai_skill_id"\r\n\r\nskill_x\r\n',
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="name"\r\n\r\nbad\r\n',
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="description"\r\n\r\nbad\r\n',
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="bundle"; filename="x.zip"\r\n'
            b"Content-Type: application/zip\r\n\r\n",
            buf.getvalue(),
            f"\r\n--{boundary}--\r\n".encode(),
        ]
        req = urllib.request.Request(
            f"{base}/v1/integrations/claude-ai/extension/imported-skill",
            method="POST",
            data=b"".join(parts),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
        )
        try:
            urllib.request.urlopen(req)
            pytest.fail("expected 422")
        except urllib.error.HTTPError as e:
            assert e.code == 422


class TestInboundLinksToExisting:
    def test_imports_into_existing_skillnote_skill_by_slug(self, api_request, paired_extension):
        """If a SkillNote skill with the same slug exists locally, the
        import should ATTACH to it rather than fail with a duplicate-slug
        error. New SkillContentVersion is appended."""
        _, token = paired_extension
        name = f"inbound-attach-{uuid.uuid4().hex[:6]}"
        # Per-run unique collection slug — previously `attach-bucket-{name[:10]}`
        # collapsed to a fixed prefix `inbound-at` because every name shared
        # that head. After 15 runs we hit the 15-skill collection limit and
        # the test failed in suite order.
        collection = f"attach-{uuid.uuid4().hex[:10]}"
        # First, create the skill via the normal API.
        status, created = api_request(
            "POST", "/v1/skills",
            body={
                "name": name, "slug": name,
                "description": "local original",
                "content_md": "# local v1\n",
                "collections": [collection],
            },
        )
        assert status == 201
        local_id = created["id"]

        # Now import from claude.ai with same slug → should attach, not duplicate.
        s, body = _upload_imported_skill(
            token, name=name, description="from claude.ai",
            claude_ai_skill_id=f"skill_attach_{uuid.uuid4().hex[:6]}",
            claude_ai_version="v1", body="# imported\n",
        )
        assert s == 201
        assert body["skillnote_skill_id"] == local_id, (
            "should reuse existing skill, not create new"
        )
        # `created` should be False because we reused.
        assert body["created"] is False


class TestConflictAutoDetection:
    def test_detects_diverged_when_both_sides_changed(
        self, api_request, paired_extension, db_session
    ):
        """The full conflict scenario:
        1. SkillNote publishes skill (v1) → upload op enqueued
        2. Extension completes upload, link created with skillnote_version_id=v1
        3. SkillNote publishes again (v2) → link's skillnote_version_id is now stale
        4. claude.ai-side modifies → inbound import comes in with new claude_ai_version
        5. Both sides changed since last sync → conflict detected
        """
        integ_id, token = paired_extension
        slug = f"div-{uuid.uuid4().hex[:6]}"

        # 1. Create skill locally — emits upload op.
        _, c1 = api_request(
            "POST", "/v1/skills",
            body={
                "name": slug, "slug": slug,
                "description": "divergence test v1",
                "content_md": "# v1",
                "collections": [f"div-bucket-{slug[:8]}"],
            },
        )
        skill_id = c1["id"]
        bearer = _bearer(token)
        _, ops = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
        ours = [op for op in ops if op["payload"].get("name") == slug][0]
        ca_id = f"skill_div_{uuid.uuid4().hex[:6]}"
        # 2. Complete the upload — link created.
        bearer(
            "POST", f"/v1/integrations/claude-ai/extension/operations/{ours['id']}/complete",
            body={
                "success": True,
                "result": {"claude_ai_skill_id": ca_id, "claude_ai_version": "remote_v1"},
            },
        )

        # 3. Update the skill locally — bumps current_version.
        api_request(
            "PATCH", f"/v1/skills/{slug}",
            body={"content_md": "# v2 (local edit)"},
        )

        # 4. Import a new version from claude.ai (simulating claude.ai-side edit).
        s, body = _upload_imported_skill(
            token, name=slug, description="divergence test v2 (remote)",
            claude_ai_skill_id=ca_id, claude_ai_version="remote_v2",
            body="# v2 (remote edit)",
        )
        assert s == 201

        # 5. Conflict list should now contain the link.
        from app.db.models.claude_ai import ClaudeAISkillLink
        from sqlalchemy import select
        link = db_session.execute(
            select(ClaudeAISkillLink).where(
                ClaudeAISkillLink.claude_ai_skill_id == ca_id
            )
        ).scalar_one()
        assert link.conflict_state == "diverged", (
            f"expected diverged, got {link.conflict_state} — both sides changed since last sync"
        )

        # Activity feed should record the detection.
        _, audit = api_request(
            "GET",
            f"/v1/integrations/claude-ai/activity?integration_id={integ_id}&event=conflict_detected",
        )
        assert any(e["event"] == "conflict_detected" for e in audit)

    def test_no_conflict_when_only_remote_changed(
        self, api_request, paired_extension, db_session
    ):
        """Only claude.ai changed (SkillNote-side has the same content
        as last push). Should NOT mark diverged — the inbound import is
        simply the new authoritative version."""
        integ_id, token = paired_extension
        slug = f"nodiv-{uuid.uuid4().hex[:6]}"
        _, c1 = api_request(
            "POST", "/v1/skills",
            body={
                "name": slug, "slug": slug,
                "description": "no-divergence v1",
                "content_md": "# v1",
                "collections": [f"nodiv-bucket-{slug[:8]}"],
            },
        )
        bearer = _bearer(token)
        _, ops = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
        ours = [op for op in ops if op["payload"].get("name") == slug][0]
        ca_id = f"skill_nodiv_{uuid.uuid4().hex[:6]}"
        bearer(
            "POST", f"/v1/integrations/claude-ai/extension/operations/{ours['id']}/complete",
            body={
                "success": True,
                "result": {"claude_ai_skill_id": ca_id, "claude_ai_version": "remote_v1"},
            },
        )

        # Skip the local update step — only remote changed.
        _upload_imported_skill(
            token, name=slug, description="no-divergence v2 (remote-only)",
            claude_ai_skill_id=ca_id, claude_ai_version="remote_v2",
            body="# v2 (remote)",
        )

        from app.db.models.claude_ai import ClaudeAISkillLink
        from sqlalchemy import select
        link = db_session.execute(
            select(ClaudeAISkillLink).where(
                ClaudeAISkillLink.claude_ai_skill_id == ca_id
            )
        ).scalar_one()
        assert link.conflict_state != "diverged", (
            f"unchanged local + changed remote should NOT diverge; got {link.conflict_state}"
        )

    def test_diverged_then_apply_does_not_duplicate_version_number(
        self, api_request, paired_extension, db_session
    ):
        """Regression: a diverged_ask stage allocates version N+1; a later
        normal apply must NOT reuse N+1. Staging now bumps the skill's version
        counter so the two never collide (which would make restore/history
        ambiguous on a shared (skill_id, version))."""
        integ_id, token = paired_extension
        slug = f"dupver-{uuid.uuid4().hex[:6]}"

        # 1. Create + push so a link exists.
        _, c1 = api_request(
            "POST", "/v1/skills",
            body={
                "name": slug, "slug": slug,
                "description": "dup-version v1", "content_md": "# v1",
                "collections": [f"dv-{slug[:8]}"],
            },
        )
        skill_id = c1["id"]
        bearer = _bearer(token)
        _, ops = bearer("GET", "/v1/integrations/claude-ai/extension/operations")
        ours = [op for op in ops if op["payload"].get("name") == slug][0]
        ca_id = f"skill_dv_{uuid.uuid4().hex[:6]}"
        bearer(
            "POST", f"/v1/integrations/claude-ai/extension/operations/{ours['id']}/complete",
            body={"success": True, "result": {"claude_ai_skill_id": ca_id, "claude_ai_version": "rv1"}},
        )

        # 2. Local edit (bumps current_version) so both sides have changed.
        api_request("PATCH", f"/v1/skills/{slug}", body={"content_md": "# v2 local"})

        # 3. Inbound import → diverged_ask (stages a version).
        s, _ = _upload_imported_skill(
            token, name=slug, description="remote v2", claude_ai_skill_id=ca_id,
            claude_ai_version="rv2", body="# v2 remote",
        )
        assert s == 201

        # 4. Second inbound import (link already diverged → no_conflict → apply).
        s, _ = _upload_imported_skill(
            token, name=slug, description="remote v3", claude_ai_skill_id=ca_id,
            claude_ai_version="rv3", body="# v3 remote",
        )
        assert s == 201

        # 5. No two content versions for this skill may share a version number.
        from app.db.models import SkillContentVersion
        from sqlalchemy import select
        import uuid as _uuid
        versions = db_session.execute(
            select(SkillContentVersion.version).where(
                SkillContentVersion.skill_id == _uuid.UUID(skill_id)
            )
        ).scalars().all()
        assert len(versions) == len(set(versions)), (
            f"duplicate content-version numbers for skill {slug}: {sorted(versions)}"
        )


class TestPairingCleanupEndpoint:
    def test_admin_cleanup_endpoint(self, api_request):
        # Endpoint always exists; even if no rows are stale, returns 0.
        status, body = api_request("POST", "/v1/integrations/claude-ai/admin/cleanup-expired-pairings")
        assert status == 200
        assert "expired" in body
        assert isinstance(body["expired"], int)


class TestExpireStalePairings:
    def test_expires_old_pending(self, db_session):
        """Direct service-level test: insert a pending row with an
        expiry timestamp 2 hours in the past, run the cleanup, verify
        the row is moved to 'error' state and an audit event fired."""
        from datetime import datetime, timedelta, timezone
        from app.db.models.claude_ai import ClaudeAIIntegration
        from app.db.models.claude_ai_polish import ClaudeAIAuditLog
        from app.services.claude_ai_sync import expire_stale_pairings
        from sqlalchemy import select

        stale = ClaudeAIIntegration(
            status="pending_approval",
            scope="both",
            conflict_policy="ask",
            browser_label="stale-test",
            pairing_code="EXPIRD",
            pairing_token_hash="x" * 64,
            pairing_expires_at=datetime.now(timezone.utc) - timedelta(hours=2),
        )
        db_session.add(stale)
        db_session.flush()

        count = expire_stale_pairings(db_session)
        db_session.flush()

        assert count >= 1
        db_session.refresh(stale)
        assert stale.status == "error"
        assert stale.pairing_code is None
        assert stale.pairing_token_hash is None

        # Audit event recorded.
        audit_rows = db_session.execute(
            select(ClaudeAIAuditLog).where(
                ClaudeAIAuditLog.integration_id == stale.id,
                ClaudeAIAuditLog.event == "pair_expired",
            )
        ).scalars().all()
        assert len(audit_rows) == 1

    def test_does_not_expire_recent_pending(self, db_session):
        from datetime import datetime, timedelta, timezone
        from app.db.models.claude_ai import ClaudeAIIntegration
        from app.services.claude_ai_sync import expire_stale_pairings

        fresh = ClaudeAIIntegration(
            status="pending_approval",
            scope="both",
            conflict_policy="ask",
            browser_label="fresh-test",
            pairing_code="FRESH1",
            pairing_token_hash="y" * 64,
            pairing_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        )
        db_session.add(fresh)
        db_session.flush()
        before_count = db_session.execute(
            __import__("sqlalchemy").text(
                "SELECT COUNT(*) FROM claude_ai_integrations WHERE status='pending_approval'"
            )
        ).scalar()

        expire_stale_pairings(db_session)
        db_session.flush()
        db_session.refresh(fresh)
        assert fresh.status == "pending_approval", "non-expired row should not be touched"
