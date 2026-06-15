"""Add partial index on claude_ai_sync_operations.completed_at.

The /analytics endpoint runs 4 aggregate queries with a `completed_at >=
cutoff` filter (24h count, 7d count, sparkline, per-integration table).
The existing composite index covers (integration_id, status, created_at)
but NOT completed_at, so date-window scans degrade with table size.

Partial index keeps the index small (most rows have completed_at IS NULL
because they're still pending / in_progress) AND still covers the
analytics access patterns since they all filter for non-null
completed_at via the status conditions.

Revision ID: 0022_sync_ops_completed_at_idx
Revises: 0021_audit_cookie_expired
Create Date: 2026-05-24
"""

from alembic import op


revision = "0022_sync_ops_completed_at_idx"
down_revision = "0021_audit_cookie_expired"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_claude_ai_sync_operations_completed_at",
        "claude_ai_sync_operations",
        ["completed_at"],
        postgresql_where="completed_at IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_claude_ai_sync_operations_completed_at",
        table_name="claude_ai_sync_operations",
    )
