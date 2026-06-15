"""Extend claude_ai_audit_log.event CHECK with general skill-lifecycle kinds.

The activity feed graduated into a unified Notifications surface: skill
create / update / delete / restore now post here too, not just connector
events (pairing is just one source among many). The event column carries a
CHECK constraint enumerating the allowed kinds, so the general lifecycle
kinds have to be added there before they can be written.

Revision ID: 0028_audit_skill_events
Revises: 0027_event_session_name
Create Date: 2026-06-12
"""

from alembic import op


revision = "0028_audit_skill_events"
down_revision = "0027_event_session_name"
branch_labels = None
depends_on = None


# The full allowed set as of 0023 (connector events + op_retried/sync_triggered).
_PRIOR_EVENTS = (
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
    "op_retried",
    "sync_triggered",
)

# General (non-connector) notifications — skill lifecycle.
_NEW_EVENTS = _PRIOR_EVENTS + (
    "skill_created",
    "skill_updated",
    "skill_deleted",
    "skill_restored",
)


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
        _expr(_PRIOR_EVENTS),
    )
