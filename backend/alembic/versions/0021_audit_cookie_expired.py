"""Add 'cookie_expired' to the claude_ai_audit_log event CHECK constraint.

Migration 0020 hard-coded the legal `event` values into the table's CHECK
constraint. Round 12 added a new event kind (`cookie_expired`) that the
backend writes when an extension reports `auth_expired=true` on a
complete_operation call. Without this migration, the INSERT fails with a
psycopg CheckViolation and the operation completion returns 500.

This migration rebuilds the CHECK constraint with the expanded value set.
Downgrade restores the original 14-value set; any `cookie_expired` rows
written between upgrade and downgrade would block the downgrade — a
clean-up step before downgrading is left to operators.

Revision ID: 0021_claude_ai_cookie_expired_event
Revises: 0020_claude_ai_polish
Create Date: 2026-05-24
"""

from alembic import op


revision = "0021_audit_cookie_expired"
down_revision = "0020_claude_ai_polish"
branch_labels = None
depends_on = None


# Mirrors backend/app/api/claude_ai.py _VALID_AUDIT_EVENTS. Keep these
# two lists in lockstep when adding/removing event kinds.
_AUDIT_EVENTS_NEW = (
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
    "cookie_expired",  # new in this migration
)

_AUDIT_EVENTS_OLD = tuple(v for v in _AUDIT_EVENTS_NEW if v != "cookie_expired")


def _check_expression(values: tuple[str, ...]) -> str:
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
        _check_expression(_AUDIT_EVENTS_NEW),
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
        _check_expression(_AUDIT_EVENTS_OLD),
    )
