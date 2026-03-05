"""add analytics events table

Revision ID: 0006
Revises: 0005
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0006_analytics_events'
down_revision = '0005_drop_tags'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'skill_call_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('skill_slug', sa.Text(), nullable=True),
        sa.Column('event_type', sa.Text(), nullable=False, server_default='called'),
        sa.Column('agent_name', sa.Text(), nullable=True),
        sa.Column('agent_version', sa.Text(), nullable=True),
        sa.Column('session_id', sa.Text(), nullable=True),
        sa.Column('collection_scope', sa.Text(), nullable=True),
        sa.Column('remote_ip', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_skill_call_events_created_at', 'skill_call_events', ['created_at'], postgresql_ops={'created_at': 'DESC'})
    op.create_index('ix_skill_call_events_slug_created_at', 'skill_call_events', ['skill_slug', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_skill_call_events_slug_created_at', table_name='skill_call_events')
    op.drop_index('ix_skill_call_events_created_at', table_name='skill_call_events')
    op.drop_table('skill_call_events')
