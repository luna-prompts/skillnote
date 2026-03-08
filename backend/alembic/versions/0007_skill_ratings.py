"""add skill_ratings table

Revision ID: 0007_skill_ratings
Revises: 0006_analytics_events
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0007_skill_ratings'
down_revision = '0006_analytics_events'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'skill_ratings',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('skill_slug', sa.Text(), nullable=False),
        sa.Column('skill_version', sa.Integer(), nullable=False),
        sa.Column('rating', sa.SmallInteger(), nullable=False),
        sa.Column('outcome', sa.Text(), nullable=True),
        sa.Column('agent_name', sa.Text(), nullable=True),
        sa.Column('session_id', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint('rating >= 1 AND rating <= 5', name='ck_skill_ratings_rating_range'),
    )
    op.create_index('ix_skill_ratings_slug_created', 'skill_ratings', ['skill_slug', 'created_at'])
    op.create_index('ix_skill_ratings_slug_version', 'skill_ratings', ['skill_slug', 'skill_version'])


def downgrade() -> None:
    op.drop_index('ix_skill_ratings_slug_version', table_name='skill_ratings')
    op.drop_index('ix_skill_ratings_slug_created', table_name='skill_ratings')
    op.drop_table('skill_ratings')
