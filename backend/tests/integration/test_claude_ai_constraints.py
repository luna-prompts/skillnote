"""Schema-level integration tests for the claude.ai connector tables.

Validates the CHECK constraints, unique indexes, and cascade behavior
declared in migration 0019_claude_ai_integration.py. Catches the kind of
regression where a refactor accidentally drops a constraint and lets
junk data into the production DB.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.db.models.claude_ai import (
    ClaudeAIIntegration,
    ClaudeAISkillLink,
    ClaudeAISyncOperation,
)


class TestCheckConstraints:
    def test_invalid_status_rejected(self, db_session):
        bad = ClaudeAIIntegration(
            status="bogus",
            scope="both",
            conflict_policy="ask",
        )
        db_session.add(bad)
        with pytest.raises(IntegrityError, match="ck_claude_ai_integrations_status"):
            db_session.commit()
        db_session.rollback()

    def test_invalid_scope_rejected(self, db_session):
        bad = ClaudeAIIntegration(
            status="active",
            scope="all-the-things",
            conflict_policy="ask",
        )
        db_session.add(bad)
        with pytest.raises(IntegrityError, match="ck_claude_ai_integrations_scope"):
            db_session.commit()
        db_session.rollback()

    def test_invalid_conflict_policy_rejected(self, db_session):
        bad = ClaudeAIIntegration(
            status="active",
            scope="both",
            conflict_policy="coin-flip",
        )
        db_session.add(bad)
        with pytest.raises(IntegrityError, match="ck_claude_ai_integrations_conflict_policy"):
            db_session.commit()
        db_session.rollback()

    def test_invalid_op_kind_rejected(self, db_session):
        integ = ClaudeAIIntegration(status="active", scope="both", conflict_policy="ask")
        db_session.add(integ)
        db_session.flush()
        bad = ClaudeAISyncOperation(
            integration_id=integ.id,
            kind="not-a-real-kind",
        )
        db_session.add(bad)
        with pytest.raises(IntegrityError, match="ck_claude_ai_sync_operations_kind"):
            db_session.commit()
        db_session.rollback()

    def test_invalid_op_status_rejected(self, db_session):
        integ = ClaudeAIIntegration(status="active", scope="both", conflict_policy="ask")
        db_session.add(integ)
        db_session.flush()
        bad = ClaudeAISyncOperation(
            integration_id=integ.id,
            kind="list",
            status="halfway",
        )
        db_session.add(bad)
        with pytest.raises(IntegrityError):
            db_session.commit()
        db_session.rollback()


class TestUniqueConstraints:
    def test_extension_token_hash_unique(self, db_session):
        """Two integrations cannot share a token hash. This is what makes
        the bearer lookup safe — exactly one row matches a given hash.
        Partial index: only enforced when extension_token_hash IS NOT NULL.
        """
        shared = "a" * 64
        a = ClaudeAIIntegration(
            status="active", scope="both", conflict_policy="ask",
            extension_token_hash=shared,
        )
        b = ClaudeAIIntegration(
            status="active", scope="both", conflict_policy="ask",
            extension_token_hash=shared,
        )
        db_session.add_all([a, b])
        with pytest.raises(IntegrityError):
            db_session.commit()
        db_session.rollback()

    def test_null_token_hashes_allowed_to_coexist(self, db_session):
        """Multiple rows with NULL token hashes are fine (the index is partial)."""
        a = ClaudeAIIntegration(status="pending_approval", scope="both", conflict_policy="ask")
        b = ClaudeAIIntegration(status="pending_approval", scope="both", conflict_policy="ask")
        db_session.add_all([a, b])
        db_session.commit()  # should not raise

    def test_skill_link_uniqueness(self, db_session):
        """A given claude.ai skill ID can only be linked once per integration."""
        integ = ClaudeAIIntegration(status="active", scope="both", conflict_policy="ask")
        db_session.add(integ)
        db_session.flush()
        a = ClaudeAISkillLink(
            integration_id=integ.id, claude_ai_skill_id="skill_dup",
        )
        b = ClaudeAISkillLink(
            integration_id=integ.id, claude_ai_skill_id="skill_dup",
        )
        db_session.add_all([a, b])
        with pytest.raises(IntegrityError, match="uq_claude_ai_skill_links"):
            db_session.commit()
        db_session.rollback()


class TestCascadeBehavior:
    def test_delete_integration_cascades_links(self, db_session):
        integ = ClaudeAIIntegration(status="active", scope="both", conflict_policy="ask")
        db_session.add(integ)
        db_session.flush()
        link = ClaudeAISkillLink(
            integration_id=integ.id, claude_ai_skill_id="skill_for_cascade",
        )
        db_session.add(link)
        op = ClaudeAISyncOperation(integration_id=integ.id, kind="list")
        db_session.add(op)
        db_session.commit()

        link_id = link.id
        op_id = op.id

        db_session.delete(integ)
        db_session.commit()

        # Both link + op should be gone.
        remaining_link = db_session.execute(
            select(ClaudeAISkillLink.id).where(ClaudeAISkillLink.id == link_id)
        ).first()
        remaining_op = db_session.execute(
            select(ClaudeAISyncOperation.id).where(ClaudeAISyncOperation.id == op_id)
        ).first()
        assert remaining_link is None, "link should cascade-delete with integration"
        assert remaining_op is None, "op should cascade-delete with integration"

    def test_delete_skill_cascades_links(self, db_session):
        """When a SkillNote skill is deleted, its claude_ai links die too.
        This is what makes the delete-op enqueue race-safe — we read the
        link's claude_ai_skill_id BEFORE the cascade fires, then enqueue
        the op so the extension can clean up claude.ai's side.
        """
        from app.db.models import Skill

        skill = Skill(
            id=uuid.uuid4(),
            name=f"cascade-{uuid.uuid4().hex[:6]}",
            slug=f"cascade-{uuid.uuid4().hex[:6]}",
            description="cascade test",
            content_md="",
            current_version=0,
        )
        db_session.add(skill)
        integ = ClaudeAIIntegration(status="active", scope="both", conflict_policy="ask")
        db_session.add(integ)
        db_session.flush()
        link = ClaudeAISkillLink(
            integration_id=integ.id,
            skillnote_skill_id=skill.id,
            claude_ai_skill_id="skill_for_skill_cascade",
        )
        db_session.add(link)
        db_session.commit()
        link_id = link.id

        db_session.delete(skill)
        db_session.commit()

        remaining = db_session.execute(
            select(ClaudeAISkillLink.id).where(ClaudeAISkillLink.id == link_id)
        ).first()
        assert remaining is None


class TestDefaults:
    def test_scope_defaults_to_both(self, db_session):
        # Use raw SQL to avoid SQLAlchemy populating defaults from the model;
        # we want to verify the DB-side server_default is the canonical source.
        result = db_session.execute(
            text(
                "INSERT INTO claude_ai_integrations (status, conflict_policy) "
                "VALUES ('active', 'ask') RETURNING scope"
            )
        ).first()
        assert result[0] == "both"
        db_session.rollback()

    def test_op_status_defaults_to_pending(self, db_session):
        integ = ClaudeAIIntegration(status="active", scope="both", conflict_policy="ask")
        db_session.add(integ)
        db_session.flush()
        result = db_session.execute(
            text(
                "INSERT INTO claude_ai_sync_operations (integration_id, kind) "
                "VALUES (:i, 'list') RETURNING status, attempts"
            ),
            {"i": integ.id},
        ).first()
        assert result[0] == "pending"
        assert result[1] == 0
        db_session.rollback()
