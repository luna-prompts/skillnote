"""add settings table

Revision ID: 0008_settings_table
Revises: 0007_skill_ratings
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa

revision = '0008_settings_table'
down_revision = '0007_skill_ratings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'settings',
        sa.Column('key', sa.Text(), primary_key=True),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.execute(
        "INSERT INTO settings (key, value) VALUES "
        "('complete_skill_enabled', 'true'), "
        "('complete_skill_outcome_enabled', 'false')"
    )


def downgrade() -> None:
    op.drop_table('settings')
