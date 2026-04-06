"""add extra_frontmatter to skills + skill_push_enabled setting

Revision ID: 0009_extra_frontmatter
Revises: 0008_settings_table
Create Date: 2026-04-06
"""
from alembic import op
import sqlalchemy as sa

revision = '0009_extra_frontmatter'
down_revision = '0008_settings_table'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('skills', sa.Column('extra_frontmatter', sa.Text(), nullable=True))
    op.execute(
        "INSERT INTO settings (key, value) VALUES ('skill_push_enabled', 'true') "
        "ON CONFLICT (key) DO NOTHING"
    )


def downgrade() -> None:
    op.drop_column('skills', 'extra_frontmatter')
    op.execute("DELETE FROM settings WHERE key = 'skill_push_enabled'")
