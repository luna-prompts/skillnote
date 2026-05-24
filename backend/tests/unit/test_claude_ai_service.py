"""Unit tests for app.services.claude_ai_sync.

Covers token generation/hashing/verification, pairing-flow helpers, and the
sync-op enqueue helpers including coalescing. Uses the real DB through the
shared db_session fixture for end-to-end realism; service helpers without DB
contact are exercised directly without a session.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.db.models.claude_ai import (
    ClaudeAIIntegration,
    ClaudeAISkillLink,
    ClaudeAISyncOperation,
)
from app.services.claude_ai_sync import (
    active_integrations_for_sync,
    enqueue_periodic_list,
    enqueue_skill_delete,
    enqueue_skill_upload,
    find_integration_by_extension_token,
    find_pending_pairing_by_code,
    find_pending_pairing_by_token,
    generate_pairing_code,
    generate_token,
    hash_token,
    integration_counters,
    pairing_expiry,
    verify_token,
)


# ── Token primitives ──────────────────────────────────────────────────────────


class TestPairingCode:
    """Pairing codes are user-typed; they must avoid visually ambiguous glyphs."""

    def test_length_is_six(self):
        assert len(generate_pairing_code()) == 6

    def test_only_uppercase_alphanumerics_minus_confusing(self):
        # Generate many to cover the alphabet probabilistically.
        codes = [generate_pairing_code() for _ in range(200)]
        for c in codes:
            assert re.match(r"^[A-Z2-9]+$", c), f"unexpected glyph in {c!r}"
            # Explicitly verify the confusable glyphs never appear.
            assert "0" not in c
            assert "O" not in c
            assert "1" not in c
            assert "I" not in c
            assert "L" not in c

    def test_codes_are_random(self):
        # 200 codes from a 31-glyph alphabet of length 6 should have very low
        # duplicate rate. Birthday-paradox math says expected collisions are
        # ~200^2 / (2 * 31^6) ≈ 0.000045 — effectively never.
        codes = {generate_pairing_code() for _ in range(200)}
        assert len(codes) >= 198, f"low uniqueness: {len(codes)}/200"


class TestExtensionToken:
    """Long bearer tokens used by the extension."""

    def test_token_length_is_substantial(self):
        # 32 random bytes -> ~43 chars of urlsafe-base64.
        t = generate_token()
        assert len(t) >= 40

    def test_tokens_are_unique(self):
        s = {generate_token() for _ in range(100)}
        assert len(s) == 100, "token generation collision"

    def test_token_only_urlsafe(self):
        # urlsafe-base64 alphabet is A-Z, a-z, 0-9, -, _ (and = padding).
        t = generate_token()
        assert re.match(r"^[A-Za-z0-9_\-=]+$", t)


class TestTokenHashing:
    def test_hash_is_deterministic(self):
        h1 = hash_token("hello")
        h2 = hash_token("hello")
        assert h1 == h2

    def test_hash_is_64_hex_chars(self):
        # sha256 = 256 bits = 64 hex chars.
        assert re.match(r"^[0-9a-f]{64}$", hash_token("anything"))

    def test_hashes_differ_for_different_inputs(self):
        assert hash_token("a") != hash_token("b")

    def test_hash_one_way(self):
        # Defense-in-depth: ensure the hash function doesn't accidentally
        # leak the original (e.g. via base64 encoding).
        h = hash_token("super-secret-token-do-not-leak")
        assert "secret" not in h
        assert "super" not in h


class TestVerifyToken:
    def test_verify_true_for_matching(self):
        raw = generate_token()
        assert verify_token(raw, hash_token(raw))

    def test_verify_false_for_mismatch(self):
        assert not verify_token("not-the-token", hash_token("real-token"))

    def test_verify_empty_strings_safe(self):
        # Should not raise; just returns False.
        assert verify_token("", hash_token("real"))  is False
        assert verify_token("real", hash_token(""))  is False


class TestPairingExpiry:
    def test_expiry_is_future(self):
        e = pairing_expiry()
        delta = e - datetime.now(timezone.utc)
        # Implementation says 10 min. Bound both ways so a regression to
        # 1-second or 100-day expiry is caught.
        assert timedelta(minutes=9) < delta < timedelta(minutes=11)


# ── DB-backed lookups ─────────────────────────────────────────────────────────


@pytest.fixture
def pending_integration(db_session):
    """Create a fresh pending_approval integration and yield (row, raw_pairing_token)."""
    raw = generate_token()
    integ = ClaudeAIIntegration(
        status="pending_approval",
        scope="both",
        browser_label="pytest pending",
        pairing_code=generate_pairing_code(),
        pairing_token_hash=hash_token(raw),
        pairing_expires_at=pairing_expiry(),
        conflict_policy="ask",
    )
    db_session.add(integ)
    db_session.commit()
    db_session.refresh(integ)
    yield integ, raw
    # db_session fixture rolls back; nothing to clean up.


@pytest.fixture
def active_integration(db_session):
    """Create an active integration and yield (row, raw_extension_token)."""
    raw_ext = generate_token()
    integ = ClaudeAIIntegration(
        status="active",
        scope="both",
        browser_label="pytest active",
        extension_token_hash=hash_token(raw_ext),
        conflict_policy="ask",
    )
    db_session.add(integ)
    db_session.commit()
    db_session.refresh(integ)
    yield integ, raw_ext


class TestPendingLookups:
    def test_by_code_finds_only_pending(self, db_session, pending_integration):
        integ, _ = pending_integration
        found = find_pending_pairing_by_code(db_session, integ.pairing_code)
        assert found is not None
        assert found.id == integ.id

    def test_by_code_is_uppercase_tolerant(self, db_session, pending_integration):
        integ, _ = pending_integration
        # Should normalize input — user types in mixed case sometimes.
        found = find_pending_pairing_by_code(db_session, integ.pairing_code.lower())
        assert found is not None
        assert found.id == integ.id

    def test_by_code_returns_none_for_unknown(self, db_session):
        assert find_pending_pairing_by_code(db_session, "ZZZZZZ") is None

    def test_by_code_returns_none_for_empty(self, db_session):
        assert find_pending_pairing_by_code(db_session, "") is None

    def test_by_code_ignores_active_rows(self, db_session, active_integration):
        # Active integrations have pairing_code=NULL, but verify the status
        # filter independently — set a code temporarily without changing status.
        integ, _ = active_integration
        integ.pairing_code = "TEST99"
        db_session.commit()
        # Status is 'active', not 'pending_approval' → not findable.
        assert find_pending_pairing_by_code(db_session, "TEST99") is None

    def test_by_token_hashes_input(self, db_session, pending_integration):
        integ, raw = pending_integration
        found = find_pending_pairing_by_token(db_session, raw)
        assert found is not None
        assert found.id == integ.id

    def test_by_token_does_not_match_hash_value(self, db_session, pending_integration):
        integ, raw = pending_integration
        # Sending the already-hashed value should NOT match — would indicate
        # a double-hash bug where the function applied hash to an already-hashed string.
        assert find_pending_pairing_by_token(db_session, hash_token(raw)) is None

    def test_by_token_returns_none_for_empty(self, db_session):
        assert find_pending_pairing_by_token(db_session, "") is None


class TestBearerLookup:
    def test_by_extension_token(self, db_session, active_integration):
        integ, raw = active_integration
        found = find_integration_by_extension_token(db_session, raw)
        assert found is not None
        assert found.id == integ.id

    def test_returns_none_for_unknown(self, db_session):
        assert find_integration_by_extension_token(db_session, "garbage") is None

    def test_returns_none_for_disconnected(self, db_session, active_integration):
        integ, raw = active_integration
        integ.status = "disconnected"
        db_session.commit()
        assert find_integration_by_extension_token(db_session, raw) is None


# ── active_integrations_for_sync ──────────────────────────────────────────────


class TestActiveIntegrations:
    def test_includes_active(self, db_session, active_integration):
        integ, _ = active_integration
        active = active_integrations_for_sync(db_session)
        assert any(a.id == integ.id for a in active)

    def test_includes_cookie_expired(self, db_session, active_integration):
        """Cookie-expired integrations still receive ops (they'll drain
        when the user re-logs in to claude.ai)."""
        integ, _ = active_integration
        integ.status = "cookie_expired"
        db_session.commit()
        active = active_integrations_for_sync(db_session)
        assert any(a.id == integ.id for a in active)

    def test_excludes_disconnected(self, db_session, active_integration):
        integ, _ = active_integration
        integ.status = "disconnected"
        db_session.commit()
        active = active_integrations_for_sync(db_session)
        assert not any(a.id == integ.id for a in active)

    def test_excludes_pending(self, db_session, pending_integration):
        integ, _ = pending_integration
        active = active_integrations_for_sync(db_session)
        assert not any(a.id == integ.id for a in active)


# ── Enqueue helpers ───────────────────────────────────────────────────────────


@pytest.fixture
def real_skill(db_session):
    """Create a Skill + one SkillContentVersion so enqueue tests have a target."""
    import uuid as _uuid
    from app.db.models import Skill, SkillContentVersion

    skill = Skill(
        id=_uuid.uuid4(),
        name=f"test-{_uuid.uuid4().hex[:6]}",
        slug=f"test-{_uuid.uuid4().hex[:6]}",
        description="A test skill",
        content_md="# Test\n",
        current_version=1,
    )
    db_session.add(skill)
    db_session.flush()
    cv = SkillContentVersion(
        id=_uuid.uuid4(),
        skill_id=skill.id,
        version=1,
        title=skill.name,
        description=skill.description,
        content_md=skill.content_md,
        is_latest=True,
    )
    db_session.add(cv)
    db_session.commit()
    yield skill, cv
    # Rolled back by db_session fixture.


class TestEnqueueSkillUpload:
    def test_creates_one_op_per_active_integration(
        self, db_session, active_integration, real_skill
    ):
        integ, _ = active_integration
        skill, cv = real_skill
        ops = enqueue_skill_upload(
            db_session,
            skill_id=skill.id,
            version_id=cv.id,
            name=skill.name,
            description=skill.description,
        )
        db_session.commit()
        assert len(ops) >= 1
        # The one for our active integration should be present.
        target = [op for op in ops if op.integration_id == integ.id]
        assert len(target) == 1
        assert target[0].kind == "upload"
        assert target[0].payload["version_id"] == str(cv.id)
        assert target[0].payload["name"] == skill.name

    def test_no_op_for_disconnected(self, db_session, active_integration, real_skill):
        integ, _ = active_integration
        integ.status = "disconnected"
        db_session.commit()
        skill, cv = real_skill
        # Pass empty integrations to isolate from any other rows.
        ops = enqueue_skill_upload(
            db_session,
            skill_id=skill.id,
            version_id=cv.id,
            name=skill.name,
            description=skill.description,
            integrations=[integ],
        )
        db_session.commit()
        assert ops == []

    def test_coalesces_repeated_calls(
        self, db_session, active_integration, real_skill
    ):
        """Rapid republishes should not pile up the queue. The second
        call must update the existing pending op's payload, not create a
        new row."""
        integ, _ = active_integration
        skill, cv = real_skill
        enqueue_skill_upload(
            db_session,
            skill_id=skill.id,
            version_id=cv.id,
            name=skill.name,
            description="first version description",
            integrations=[integ],
        )
        db_session.commit()
        # Same skill, different description (simulating a republish).
        ops2 = enqueue_skill_upload(
            db_session,
            skill_id=skill.id,
            version_id=cv.id,
            name=skill.name,
            description="updated description",
            integrations=[integ],
        )
        db_session.commit()
        # No new op created.
        assert ops2 == []
        # The existing pending op now has the updated payload.
        pending = db_session.execute(
            select(ClaudeAISyncOperation)
            .where(ClaudeAISyncOperation.integration_id == integ.id)
            .where(ClaudeAISyncOperation.skill_id == skill.id)
            .where(ClaudeAISyncOperation.status == "pending")
        ).scalars().all()
        assert len(pending) == 1
        assert pending[0].payload["description"] == "updated description"

    def test_creates_new_op_after_previous_completed(
        self, db_session, active_integration, real_skill
    ):
        """Once an upload finishes, a new publish must enqueue a fresh op
        (the coalesce window is bounded by 'pending' or 'in_progress')."""
        integ, _ = active_integration
        skill, cv = real_skill
        ops = enqueue_skill_upload(
            db_session, skill_id=skill.id, version_id=cv.id,
            name=skill.name, description="v1", integrations=[integ],
        )
        db_session.commit()
        assert len(ops) == 1
        ops[0].status = "completed"
        db_session.commit()

        ops2 = enqueue_skill_upload(
            db_session, skill_id=skill.id, version_id=cv.id,
            name=skill.name, description="v2", integrations=[integ],
        )
        db_session.commit()
        assert len(ops2) == 1


class TestEnqueueSkillDelete:
    def test_skips_unlinked_skills(self, db_session, active_integration, real_skill):
        """If the skill was never synced to claude.ai (no link row), no
        delete op is needed."""
        integ, _ = active_integration
        skill, _ = real_skill
        ops = enqueue_skill_delete(
            db_session, skill_id=skill.id, integrations=[integ]
        )
        db_session.commit()
        assert ops == []

    def test_creates_op_for_linked_skill(
        self, db_session, active_integration, real_skill
    ):
        integ, _ = active_integration
        skill, _ = real_skill
        # Create a link so the delete enqueue has something to target.
        link = ClaudeAISkillLink(
            integration_id=integ.id,
            skillnote_skill_id=skill.id,
            claude_ai_skill_id="skill_ext_01ABCDEF",
            direction="outbound",
        )
        db_session.add(link)
        db_session.commit()

        ops = enqueue_skill_delete(db_session, skill_id=skill.id)
        db_session.commit()
        # We don't filter by integration here — should match the linked one.
        assert any(
            op.integration_id == integ.id and op.kind == "delete"
            for op in ops
        )
        # Op payload carries the claude.ai-side ID.
        for op in ops:
            if op.integration_id == integ.id:
                assert op.payload["claude_ai_skill_id"] == "skill_ext_01ABCDEF"


class TestEnqueuePeriodicList:
    def test_creates_one_list_op_per_active(
        self, db_session, active_integration
    ):
        integ, _ = active_integration
        ops = enqueue_periodic_list(db_session, [integ])
        db_session.commit()
        assert len(ops) == 1
        assert ops[0].kind == "list"
        assert ops[0].integration_id == integ.id

    def test_coalesces_against_pending(
        self, db_session, active_integration
    ):
        integ, _ = active_integration
        enqueue_periodic_list(db_session, [integ])
        db_session.commit()
        ops2 = enqueue_periodic_list(db_session, [integ])
        db_session.commit()
        assert ops2 == [], "second tick should not double-enqueue"


# ── Counters ──────────────────────────────────────────────────────────────────


class TestIntegrationCounters:
    def test_zero_state(self, db_session, active_integration):
        integ, _ = active_integration
        c = integration_counters(db_session, integ.id)
        assert c == {
            "pending_op_count": 0,
            "failed_op_count": 0,
            "linked_skill_count": 0,
        }

    def test_counts_pending_and_failed(self, db_session, active_integration):
        integ, _ = active_integration
        db_session.add(
            ClaudeAISyncOperation(integration_id=integ.id, kind="list", status="pending")
        )
        db_session.add(
            ClaudeAISyncOperation(integration_id=integ.id, kind="list", status="in_progress")
        )
        db_session.add(
            ClaudeAISyncOperation(integration_id=integ.id, kind="list", status="failed")
        )
        db_session.add(
            ClaudeAISyncOperation(integration_id=integ.id, kind="list", status="completed")
        )
        db_session.commit()
        c = integration_counters(db_session, integ.id)
        assert c["pending_op_count"] == 2  # pending + in_progress
        assert c["failed_op_count"] == 1
        # Completed ops aren't counted in either bucket — by design (they're
        # historical, not action items).

    def test_counts_links(self, db_session, active_integration, real_skill):
        integ, _ = active_integration
        skill, _ = real_skill
        db_session.add(
            ClaudeAISkillLink(
                integration_id=integ.id,
                skillnote_skill_id=skill.id,
                claude_ai_skill_id="skill_ext_link_1",
            )
        )
        db_session.commit()
        c = integration_counters(db_session, integ.id)
        assert c["linked_skill_count"] == 1
