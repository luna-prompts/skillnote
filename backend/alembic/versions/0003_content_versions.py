"""add skill_content_versions table and current_version to skills

Revision ID: 0003_content_versions
Revises: 0002_skill_rich_fields
Create Date: 2026-02-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_content_versions"
down_revision = "0002_skill_rich_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add current_version to skills table
    op.add_column("skills", sa.Column("current_version", sa.Integer(), nullable=True, server_default="0"))

    # Create skill_content_versions table
    op.create_table(
        "skill_content_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("skill_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("content_md", sa.Text(), nullable=False, server_default=""),
        sa.Column("tags", postgresql.ARRAY(sa.Text()), nullable=True, server_default="{}"),
        sa.Column("collections", postgresql.ARRAY(sa.Text()), nullable=True, server_default="{}"),
        sa.Column("is_latest", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_skill_content_versions_skill_id", "skill_content_versions", ["skill_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_skill_content_versions_skill_id", table_name="skill_content_versions")
    op.drop_table("skill_content_versions")
    op.drop_column("skills", "current_version")
