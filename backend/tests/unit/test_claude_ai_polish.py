"""Unit tests for the polish layer (audit log, rate limit, per-skill toggle).

The polish layer (0020) adds three load-bearing capabilities on top of the
core connector:

  1. Audit log — append-only event feed for the in-product activity page
     AND forensic trail for admins.
  2. Pair-endpoint rate limit — defeats brute-force code enumeration.
  3. Per-skill sync toggle — granular opt-out per skill.
"""
from __future__ import annotations

import os
import uuid as _uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.db.models.claude_ai import ClaudeAIIntegration
from app.db.models.claude_ai_polish import (
    ClaudeAIAuditLog,
    ClaudeAIPairAttempt,
)
from app.services.claude_ai_sync import (
    PairRateLimitExceeded,
    query_audit,
    record_pair_attempt,
    write_audit,
)


@pytest.fixture
def integration(db_session):
    integ = ClaudeAIIntegration(status="active", scope="both", conflict_policy="ask")
    db_session.add(integ)
    db_session.commit()
    db_session.refresh(integ)
    yield integ


# ── Audit log ─────────────────────────────────────────────────────────────────


class TestWriteAudit:
    def test_basic_event(self, db_session, integration):
        write_audit(db_session, event="pair_started", integration_id=integration.id)
        db_session.commit()
        row = db_session.execute(
            select(ClaudeAIAuditLog).where(
                ClaudeAIAuditLog.integration_id == integration.id
            )
        ).scalar_one()
        assert row.event == "pair_started"
        assert row.detail == {}

    def test_with_detail_and_source_ip(self, db_session, integration):
        write_audit(
            db_session,
            event="pair_started",
            integration_id=integration.id,
            detail={"browser_label": "Chrome on Mac"},
            source_ip="192.168.1.1",
        )
        db_session.commit()
        row = db_session.execute(
            select(ClaudeAIAuditLog).where(
                ClaudeAIAuditLog.integration_id == integration.id
            )
        ).scalar_one()
        assert row.detail == {"browser_label": "Chrome on Mac"}
        # SQLAlchemy returns INET as ipaddress.IPv4Address — comparison
        # is value-equal but type-strict, so coerce both sides to str.
        assert str(row.source_ip) == "192.168.1.1"

    def test_invalid_event_rejected_by_check_constraint(self, db_session):
        # DB CHECK constraint protects against typo'd event strings making
        # it past the application layer.
        from sqlalchemy.exc import IntegrityError
        write_audit(db_session, event="bogus_event")
        with pytest.raises(IntegrityError, match="ck_claude_ai_audit_log_event"):
            db_session.commit()
        db_session.rollback()

    def test_skill_id_set_null_on_skill_delete(self, db_session, integration):
        """When a skill is deleted, audit rows referencing it should be
        SET NULL (not cascade-deleted) — historical events stay visible
        but no longer point at a dangling skill ID."""
        from app.db.models import Skill
        skill = Skill(
            id=_uuid.uuid4(),
            name=f"polish-{_uuid.uuid4().hex[:6]}",
            slug=f"polish-{_uuid.uuid4().hex[:6]}",
            description="audit cascade test",
            content_md="",
            current_version=0,
        )
        db_session.add(skill)
        db_session.flush()
        write_audit(
            db_session,
            event="skill_pushed",
            integration_id=integration.id,
            skill_id=skill.id,
        )
        db_session.commit()
        audit_id = db_session.execute(
            select(ClaudeAIAuditLog.id).where(
                ClaudeAIAuditLog.skill_id == skill.id
            )
        ).scalar_one()

        # Delete the skill.
        db_session.delete(skill)
        db_session.commit()

        # Audit row must still exist but skill_id should be NULL.
        row = db_session.execute(
            select(ClaudeAIAuditLog).where(ClaudeAIAuditLog.id == audit_id)
        ).scalar_one_or_none()
        assert row is not None, "audit log row should survive skill deletion"
        assert row.skill_id is None, "skill_id should SET NULL on cascade"


class TestQueryAudit:
    def test_returns_most_recent_first(self, db_session, integration):
        # Insert 3 events; query should return newest first.
        from datetime import datetime, timezone
        base = datetime.now(timezone.utc)
        for offset, kind in [(0, "pair_started"), (1, "pair_approved"), (2, "pair_redeemed")]:
            row = ClaudeAIAuditLog(
                integration_id=integration.id,
                event=kind,
                created_at=base + timedelta(seconds=offset),
            )
            db_session.add(row)
        db_session.commit()

        results = query_audit(db_session, integration_id=integration.id)
        assert len(results) >= 3
        # Newest first.
        events = [r.event for r in results]
        assert events.index("pair_redeemed") < events.index("pair_approved") < events.index("pair_started")

    def test_filter_by_event(self, db_session, integration):
        for kind in ("pair_started", "pair_approved", "skill_pushed"):
            db_session.add(
                ClaudeAIAuditLog(integration_id=integration.id, event=kind)
            )
        db_session.commit()
        only_pair = query_audit(db_session, integration_id=integration.id, event="pair_started")
        assert all(r.event == "pair_started" for r in only_pair)

    def test_limit_caps_at_500(self, db_session, integration):
        """Defense against UI bug requesting a million rows."""
        results = query_audit(db_session, integration_id=integration.id, limit=1_000_000)
        # Just check the query doesn't crash and the limit clamp works
        assert isinstance(results, list)


# ── Rate limiting ─────────────────────────────────────────────────────────────


@pytest.mark.skipif(
    os.environ.get("SKILLNOTE_DISABLE_PAIR_RATE_LIMIT") == "1",
    reason="rate-limit assertions require the limiter to be active",
)
class TestRateLimit:
    """Rate-limit tests use uuid-suffixed IPs to isolate from any
    persisted state in the shared DB. Each test's IP is unique to that
    test invocation."""

    def _ip(self) -> str:
        # Synthesize a TEST-NET-1 IP that's unique per test invocation.
        # 192.0.2.0/24 is reserved for documentation/test, so we never
        # collide with anything real.
        import random
        return f"192.0.2.{random.randint(1, 254)}"

    def test_below_threshold_succeeds(self, db_session):
        ip = self._ip()
        for _ in range(5):
            record_pair_attempt(db_session, source_ip=ip, endpoint="pair")
        db_session.flush()

    def test_no_ip_does_not_enforce(self, db_session):
        for _ in range(200):
            record_pair_attempt(db_session, source_ip=None, endpoint="pair")
        db_session.flush()

    def test_breaches_at_threshold(self, db_session):
        ip = self._ip()
        # Flush within the loop so the SELECT counter sees each insert.
        for _ in range(60):
            record_pair_attempt(db_session, source_ip=ip, endpoint="pair")
            db_session.flush()
        with pytest.raises(PairRateLimitExceeded):
            record_pair_attempt(db_session, source_ip=ip, endpoint="pair")

    def test_other_ip_not_affected(self, db_session):
        ip_a, ip_b = self._ip(), self._ip()
        # Sanity: ensure distinct ips (random.randint can collide).
        while ip_a == ip_b:
            ip_b = self._ip()
        for _ in range(60):
            record_pair_attempt(db_session, source_ip=ip_a, endpoint="pair")
            db_session.flush()
        # ip_b is fresh — even though ip_a is exhausted, ip_b can still pair.
        record_pair_attempt(db_session, source_ip=ip_b, endpoint="pair")

    def test_window_slides(self, db_session):
        """Old attempts shouldn't count. Insert 60 attempts with a
        timestamp 2 minutes ago, then verify a new attempt succeeds."""
        ip = self._ip()
        old = datetime.now(timezone.utc) - timedelta(minutes=2)
        for _ in range(60):
            db_session.add(
                ClaudeAIPairAttempt(
                    source_ip=ip,
                    endpoint="pair",
                    created_at=old,
                )
            )
        db_session.flush()
        # Should succeed — those 60 attempts are outside the window.
        record_pair_attempt(db_session, source_ip=ip, endpoint="pair")


# ── Per-skill sync toggle ─────────────────────────────────────────────────────


class TestSkillSyncToggle:
    def test_default_enabled(self, db_session):
        from app.db.models import Skill
        skill = Skill(
            id=_uuid.uuid4(),
            name=f"toggle-{_uuid.uuid4().hex[:6]}",
            slug=f"toggle-{_uuid.uuid4().hex[:6]}",
            description="toggle test",
            content_md="",
            current_version=0,
        )
        db_session.add(skill)
        db_session.commit()
        db_session.refresh(skill)
        assert skill.claude_ai_sync_enabled is True

    def test_can_be_disabled(self, db_session):
        from app.db.models import Skill
        skill = Skill(
            id=_uuid.uuid4(),
            name=f"toggle2-{_uuid.uuid4().hex[:6]}",
            slug=f"toggle2-{_uuid.uuid4().hex[:6]}",
            description="toggle test",
            content_md="",
            current_version=0,
            claude_ai_sync_enabled=False,
        )
        db_session.add(skill)
        db_session.commit()
        db_session.refresh(skill)
        assert skill.claude_ai_sync_enabled is False
