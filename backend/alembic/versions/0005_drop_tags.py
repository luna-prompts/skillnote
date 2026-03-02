"""drop tags columns

Revision ID: 0005
Revises: 0004
Create Date: 2026-03-02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0005_drop_tags'
down_revision = '0004_drop_auth_tables'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('skills', 'tags')
    op.drop_column('skill_content_versions', 'tags')


def downgrade() -> None:
    op.add_column('skill_content_versions', sa.Column('tags', postgresql.ARRAY(sa.Text()), nullable=True, server_default='{}'))
    op.add_column('skills', sa.Column('tags', postgresql.ARRAY(sa.Text()), nullable=True, server_default='{}'))
