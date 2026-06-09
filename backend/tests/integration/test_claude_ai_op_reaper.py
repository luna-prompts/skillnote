"""Stalled-operation reaper: orphaned `in_progress` ops are reclaimed.

An op is leased to one extension at fetch time (status → in_progress). If that
extension never reports a result — browser closed, service worker killed — the
op would sit in_progress forever, never retried and invisible to the queue
counters. `reclaim_stale_operations` puts lease-expired ops back to `pending`
(or `failed` once the retry budget is spent).

Service-level tests via the rolled-back `db_session` fixture — hermetic, no
dependency on a running API or shared-DB state.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest


def _mk_integration(db):
    from app.db.models.claude_ai import ClaudeAIIntegration

    integ = ClaudeAIIntegration(
        status="active",
        scope="both",
        conflict_policy="ask",
        browser_label="reaper-test",
    )
    db.add(integ)
    db.flush()
    return integ


def _mk_op(db, integ, *, status, attempts, started_at, kind="upload"):
    from app.db.models.claude_ai import ClaudeAISyncOperation

    op = ClaudeAISyncOperation(
        integration_id=integ.id,
        kind=kind,
        status=status,
        attempts=attempts,
        payload={"name": "x", "description": "y", "version_id": "v"},
        started_at=started_at,
    )
    db.add(op)
    db.flush()
    return op


class TestReclaimStaleOperations:
    def test_reclaims_stalled_op_back_to_pending(self, db_session):
        from app.services.claude_ai_sync import reclaim_stale_operations

        now = datetime(2026, 5, 30, 12, 0, 0, tzinfo=timezone.utc)
        integ = _mk_integration(db_session)
        op = _mk_op(
            db_session, integ,
            status="in_progress", attempts=1,
            started_at=now - timedelta(minutes=11),  # past the 10-min lease
        )

        n = reclaim_stale_operations(db_session, now=now)
        db_session.flush()
        db_session.refresh(op)

        assert n == 1
        assert op.status == "pending"
        assert op.started_at is None
        assert op.attempts == 1  # not incremented by the reaper

    def test_marks_exhausted_op_failed(self, db_session):
        from app.services.claude_ai_sync import reclaim_stale_operations

        now = datetime(2026, 5, 30, 12, 0, 0, tzinfo=timezone.utc)
        integ = _mk_integration(db_session)
        op = _mk_op(
            db_session, integ,
            status="in_progress", attempts=3,  # retry budget exhausted
            started_at=now - timedelta(minutes=15),
        )

        n = reclaim_stale_operations(db_session, now=now)
        db_session.flush()
        db_session.refresh(op)

        assert n == 1
        assert op.status == "failed"
        assert op.completed_at is not None
        assert "imed out" in (op.last_error or "")

    def test_leaves_fresh_in_progress_op_alone(self, db_session):
        from app.services.claude_ai_sync import reclaim_stale_operations

        now = datetime(2026, 5, 30, 12, 0, 0, tzinfo=timezone.utc)
        integ = _mk_integration(db_session)
        op = _mk_op(
            db_session, integ,
            status="in_progress", attempts=1,
            started_at=now - timedelta(minutes=2),  # still within the lease
        )

        n = reclaim_stale_operations(db_session, now=now)
        db_session.flush()
        db_session.refresh(op)

        assert n == 0
        assert op.status == "in_progress"

    def test_ignores_pending_and_completed_ops(self, db_session):
        from app.services.claude_ai_sync import reclaim_stale_operations

        now = datetime(2026, 5, 30, 12, 0, 0, tzinfo=timezone.utc)
        integ = _mk_integration(db_session)
        old = now - timedelta(hours=1)
        pending = _mk_op(db_session, integ, status="pending", attempts=0, started_at=None)
        completed = _mk_op(db_session, integ, status="completed", attempts=1, started_at=old)

        n = reclaim_stale_operations(db_session, now=now)
        db_session.flush()
        db_session.refresh(pending)
        db_session.refresh(completed)

        assert n == 0
        assert pending.status == "pending"
        assert completed.status == "completed"

    def test_writes_audit_event_for_reclaimed_op(self, db_session):
        from sqlalchemy import select
        from app.db.models.claude_ai_polish import ClaudeAIAuditLog
        from app.services.claude_ai_sync import reclaim_stale_operations

        now = datetime(2026, 5, 30, 12, 0, 0, tzinfo=timezone.utc)
        integ = _mk_integration(db_session)
        _mk_op(
            db_session, integ,
            status="in_progress", attempts=1,
            started_at=now - timedelta(minutes=20),
        )

        reclaim_stale_operations(db_session, now=now)
        db_session.flush()

        events = db_session.execute(
            select(ClaudeAIAuditLog.event).where(
                ClaudeAIAuditLog.integration_id == integ.id
            )
        ).scalars().all()
        # Reclaimed-to-pending records an op_retried event.
        assert "op_retried" in events
