"""create collections table

Revision ID: 0011_collections_table
Revises: 0010_pick_sessions
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = '0011_collections_table'
down_revision = '0010_pick_sessions'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'collections',
        sa.Column('name', sa.Text(), primary_key=True),
        sa.Column('description', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # Prevent case-variant duplicates ("Frontend" vs "frontend")
    op.create_index('ix_collections_name_ci', 'collections', [sa.text('lower(name)')], unique=True)


def downgrade() -> None:
    op.drop_index('ix_collections_name_ci', table_name='collections')
    op.drop_table('collections')
