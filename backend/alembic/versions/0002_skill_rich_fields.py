"""add rich fields to skills and comments table

Revision ID: 0002_skill_rich_fields
Revises: 0001_initial
Create Date: 2026-02-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002_skill_rich_fields"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add rich fields to skills
    op.add_column("skills", sa.Column("content_md", sa.Text(), nullable=True, server_default=""))
    op.add_column("skills", sa.Column("tags", postgresql.ARRAY(sa.Text()), nullable=True, server_default="{}"))
    op.add_column("skills", sa.Column("collections", postgresql.ARRAY(sa.Text()), nullable=True, server_default="{}"))

    # Comments table
    op.create_table(
        "comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("skill_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author", sa.String(255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_comments_skill_id", "comments", ["skill_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_comments_skill_id", table_name="comments")
    op.drop_table("comments")
    op.drop_column("skills", "collections")
    op.drop_column("skills", "tags")
    op.drop_column("skills", "content_md")
