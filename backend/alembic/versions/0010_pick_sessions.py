"""add collection_pick_sessions table

Revision ID: 0010_pick_sessions
Revises: 0009_extra_frontmatter
Create Date: 2026-04-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0010_pick_sessions'
down_revision = '0009_extra_frontmatter'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'collection_pick_sessions',
        sa.Column('token', sa.Text(), primary_key=True),
        sa.Column('status', sa.Text(), nullable=False, server_default='pending'),
        sa.Column('result_collections', postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('collection_pick_sessions')
