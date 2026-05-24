"""0020 claude_ai_polish — audit log + per-skill sync toggle + rate-limit table

Adds the polish layer on top of 0019:

  * claude_ai_audit_log     — append-only event feed (who did what when)
  * claude_ai_pair_attempts — rate-limit tracking for pair endpoint
  * skills.claude_ai_sync_enabled — per-skill opt-in toggle (default TRUE
    so existing skills sync, but UI surfaces it for granular control)

Revision ID: 0020_claude_ai_polish
Revises: 0019_claude_ai_integration
Create Date: 2026-05-24
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID, INET


revision = "0020_claude_ai_polish"
down_revision = "0019_claude_ai_integration"
branch_labels = None
depends_on = None


AUDIT_EVENT_VALUES = (
    "pair_started",
    "pair_approved",
    "pair_redeemed",
    "pair_expired",
    "integration_disconnected",
    "integration_updated",
    "skill_pushed",
    "skill_imported",
    "skill_delete_pushed",
    "op_failed",
    "conflict_detected",
    "conflict_resolved",
    "endpoint_changed",
    "token_revoked",
)


def upgrade() -> None:
    # ── claude_ai_audit_log ───────────────────────────────────────────────────
    # Append-only. Drives the in-product activity feed and gives admins a
    # forensic trail for "who synced what when" questions. Indexed for
    # the common case: "show me the last N events for this integration."
    op.create_table(
        "claude_ai_audit_log",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "integration_id",
            UUID(as_uuid=True),
            sa.ForeignKey("claude_ai_integrations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("event", sa.Text(), nullable=False),
        sa.Column(
            "skill_id",
            UUID(as_uuid=True),
            sa.ForeignKey("skills.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # Free-form details — exact shape depends on event type. The
        # activity feed renders these via a small switch in the UI.
        sa.Column("detail", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        # IPs help admins distinguish "expected pairing from office network"
        # vs "someone tried to pair from a coffee shop IP." Captured at the
        # boundary; nullable for events that don't have an originating IP.
        sa.Column("source_ip", INET, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "event IN (" + ", ".join(f"'{v}'" for v in AUDIT_EVENT_VALUES) + ")",
            name="ck_claude_ai_audit_log_event",
        ),
    )
    # Per-integration feed (the hot query for the activity page).
    op.create_index(
        "ix_claude_ai_audit_log_integration_created",
        "claude_ai_audit_log",
        ["integration_id", "created_at"],
    )
    # Global feed sort.
    op.create_index(
        "ix_claude_ai_audit_log_created_at",
        "claude_ai_audit_log",
        ["created_at"],
    )

    # ── claude_ai_pair_attempts ───────────────────────────────────────────────
    # Records every POST /pair to enforce rate limits. A simple sliding window
    # over the most recent row count per IP is enough for the threat we're
    # defending against: brute-force enumeration of pairing codes.
    op.create_table(
        "claude_ai_pair_attempts",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("source_ip", INET, nullable=True),
        sa.Column("endpoint", sa.Text(), nullable=False),  # 'pair' | 'approve' | 'status'
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_claude_ai_pair_attempts_ip_created",
        "claude_ai_pair_attempts",
        ["source_ip", "created_at"],
    )
    op.create_index(
        "ix_claude_ai_pair_attempts_created_at",
        "claude_ai_pair_attempts",
        ["created_at"],
    )

    # ── skills.claude_ai_sync_enabled ─────────────────────────────────────────
    # Per-skill opt-in. Defaults to TRUE so the new connector immediately
    # syncs all existing skills (no surprise gap during rollout); the UI
    # surfaces a toggle for users who want to keep specific skills local.
    op.add_column(
        "skills",
        sa.Column(
            "claude_ai_sync_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("skills", "claude_ai_sync_enabled")

    op.drop_index("ix_claude_ai_pair_attempts_created_at", table_name="claude_ai_pair_attempts")
    op.drop_index("ix_claude_ai_pair_attempts_ip_created", table_name="claude_ai_pair_attempts")
    op.drop_table("claude_ai_pair_attempts")

    op.drop_index("ix_claude_ai_audit_log_created_at", table_name="claude_ai_audit_log")
    op.drop_index("ix_claude_ai_audit_log_integration_created", table_name="claude_ai_audit_log")
    op.drop_table("claude_ai_audit_log")
