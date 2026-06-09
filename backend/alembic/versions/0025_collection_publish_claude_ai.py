"""Add collections.published_to_claude_ai — the per-collection toggle that
controls whether a collection is published to claude.ai as its own named
plugin group ("SkillNote: <collection>").

Revision ID: 0025_collection_publish_ca
Revises: 0024_sync_op_publish_group
"""
import sqlalchemy as sa
from alembic import op

revision = "0025_collection_publish_ca"
down_revision = "0024_sync_op_publish_group"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "collections",
        sa.Column(
            "published_to_claude_ai",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("collections", "published_to_claude_ai")
