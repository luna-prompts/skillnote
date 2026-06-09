"""Regression: enqueue_skill_upload coalescing must not drop a new version
when the only in-flight op for the skill is already in_progress.

Bug: _has_pending_op matched both pending AND in_progress, then the code
re-queried for a pending row to update its payload. When the only match was
in_progress (extension currently executing), that re-query returned None and
the branch fell through to `continue` — enqueuing nothing. The just-saved
version was silently never synced.

Fix: coalesce only against a pending op; if the only op is in_progress,
enqueue a FRESH pending op so the new version syncs after the in-flight one.

Service-level via the rolled-back db_session fixture — hermetic.
"""
from __future__ import annotations


import pytest  # noqa: E402

pytestmark = pytest.mark.skip(reason=(
    'Superseded by the per-collection named-group model: one debounced `publish_group` op rebuilds the whole "SkillNote: <collection>" group, replacing the per-skill upload/delete/conflict op contract this file asserts. New contract is covered by tests/unit/test_claude_ai_service.py and tests/integration/test_claude_ai_plugin_bundle.py.'
))

import uuid

import pytest


def _mk_integration(db):
    from app.db.models.claude_ai import ClaudeAIIntegration

    integ = ClaudeAIIntegration(
        status="active", scope="both", conflict_policy="ask",
        browser_label="coalesce-test",
    )
    db.add(integ)
    db.flush()
    return integ


def _mk_skill(db):
    """Create a real Skill row (ops carry an FK to skills.id)."""
    from app.db.models import Skill

    suffix = uuid.uuid4().hex[:8]
    skill = Skill(
        id=uuid.uuid4(),
        name=f"coalesce-{suffix}",
        slug=f"coalesce-{suffix}",
        description="coalesce test",
        content_md="# x",
        collections=[],
        current_version=0,
    )
    db.add(skill)
    db.flush()
    return skill.id


def _upload_ops(db, integ_id, skill_id):
    from sqlalchemy import select
    from app.db.models.claude_ai import ClaudeAISyncOperation
    return db.execute(
        select(ClaudeAISyncOperation).where(
            ClaudeAISyncOperation.integration_id == integ_id,
            ClaudeAISyncOperation.skill_id == skill_id,
            ClaudeAISyncOperation.kind == "upload",
        )
    ).scalars().all()


class TestEnqueueCoalesce:
    def test_pending_op_is_coalesced_payload_updated(self, db_session):
        from app.services.claude_ai_sync import enqueue_skill_upload

        integ = _mk_integration(db_session)
        sid = _mk_skill(db_session)
        v1, v2 = uuid.uuid4(), uuid.uuid4()
        enqueue_skill_upload(db_session, skill_id=sid, version_id=v1, name="s", description="d", integrations=[integ])
        enqueue_skill_upload(db_session, skill_id=sid, version_id=v2, name="s", description="d2", integrations=[integ])
        db_session.flush()

        ops = _upload_ops(db_session, integ.id, sid)
        # Still a single op (coalesced), now carrying the latest version.
        assert len(ops) == 1
        assert ops[0].status == "pending"
        assert ops[0].payload["version_id"] == str(v2)

    def test_in_progress_op_does_not_swallow_new_version(self, db_session):
        """The core regression: a save while an upload is in_progress must
        enqueue a fresh pending op, not be dropped."""
        from app.services.claude_ai_sync import enqueue_skill_upload

        integ = _mk_integration(db_session)
        sid = _mk_skill(db_session)
        v1, v2 = uuid.uuid4(), uuid.uuid4()

        # First save → one pending op. Simulate the extension fetching it
        # (status flips to in_progress with the v1 payload).
        enqueue_skill_upload(db_session, skill_id=sid, version_id=v1, name="s", description="d", integrations=[integ])
        db_session.flush()
        op1 = _upload_ops(db_session, integ.id, sid)[0]
        op1.status = "in_progress"
        db_session.flush()

        # Second save lands while op1 is in_progress.
        enqueue_skill_upload(db_session, skill_id=sid, version_id=v2, name="s", description="d2", integrations=[integ])
        db_session.flush()

        ops = _upload_ops(db_session, integ.id, sid)
        # A NEW pending op must exist carrying v2 (the in_progress op keeps v1).
        statuses = sorted(o.status for o in ops)
        assert statuses == ["in_progress", "pending"], f"expected a fresh pending op, got {statuses}"
        pending = [o for o in ops if o.status == "pending"][0]
        assert pending.payload["version_id"] == str(v2), "new version must be queued, not dropped"
        inprog = [o for o in ops if o.status == "in_progress"][0]
        assert inprog.payload["version_id"] == str(v1)
