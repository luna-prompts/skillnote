"""Extend claude_ai_audit_log.event CHECK with op_retried + sync_triggered.

The /operations/{id}/retry and /integrations/{id}/trigger-sync endpoints
were reusing the generic `integration_updated` event kind to keep the
CHECK constraint surface small. The result was an activity feed where
"someone updated something" rows piled up without telling you whether
they were settings changes, retries, or sync nudges. Dedicated event
kinds let the activity-feed UI label them distinctly and let operators
filter by them.

Revision ID: 0023_audit_ops_events
Revises: 0022_sync_ops_completed_at_idx
Create Date: 2026-05-24
"""

from alembic import op


revision = "0023_audit_ops_events"
down_revision = "0022_sync_ops_completed_at_idx"
branch_labels = None
depends_on = None


_BASE_EVENTS = (
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
    "cookie_expired",
)

_NEW_EVENTS = _BASE_EVENTS + ("op_retried", "sync_triggered")


def _expr(values: tuple[str, ...]) -> str:
    return "event IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def upgrade() -> None:
    op.drop_constraint(
        "ck_claude_ai_audit_log_event",
        "claude_ai_audit_log",
        type_="check",
    )
    op.create_check_constraint(
        "ck_claude_ai_audit_log_event",
        "claude_ai_audit_log",
        _expr(_NEW_EVENTS),
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_claude_ai_audit_log_event",
        "claude_ai_audit_log",
        type_="check",
    )
    op.create_check_constraint(
        "ck_claude_ai_audit_log_event",
        "claude_ai_audit_log",
        _expr(_BASE_EVENTS),
    )
