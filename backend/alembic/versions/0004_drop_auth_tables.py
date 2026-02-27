"""drop access_tokens and token_skill_grants tables

Revision ID: 0004_drop_auth_tables
Revises: 0003_content_versions
Create Date: 2026-02-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_drop_auth_tables"
down_revision = "0003_content_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("token_skill_grants")
    op.drop_table("access_tokens")


def downgrade() -> None:
    op.create_table(
        "access_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("token_hash", sa.String(128), unique=True, nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("subject_type", sa.String(32), nullable=False, server_default="user"),
        sa.Column("subject_id", sa.String(255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_table(
        "token_skill_grants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("token_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("access_tokens.id", ondelete="CASCADE"), nullable=False),
        sa.Column("skill_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("token_id", "skill_id", name="uq_token_skill"),
    )
    op.create_index("ix_token_skill_grants_token_id", "token_skill_grants", ["token_id"])
    op.create_index("ix_token_skill_grants_skill_id", "token_skill_grants", ["skill_id"])
