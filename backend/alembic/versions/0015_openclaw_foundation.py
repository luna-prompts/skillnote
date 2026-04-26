"""0015 openclaw foundation — pgvector, skill_usage_events, comments extension

Adds:
- CREATE EXTENSION vector (pgvector)
- skills.embedding vector(1536) + HNSW cosine index
- skill_usage_events table for openclaw usage logging
- comments table extended with author_type, comment_type, rating, linked_usage_id

Revision ID: 0015_openclaw_foundation
Revises: 0014_subpath_not_null
Create Date: 2026-04-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

# pgvector SQLAlchemy type
from pgvector.sqlalchemy import Vector

revision = "0015_openclaw_foundation"
down_revision = "0014_subpath_not_null"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # a. Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # b. Add embedding column to skills
    op.add_column('skills', sa.Column('embedding', Vector(1536), nullable=True))
    op.execute("CREATE INDEX ix_skills_embedding_hnsw ON skills USING hnsw (embedding vector_cosine_ops)")

    # c. Create skill_usage_events table
    op.create_table(
        'skill_usage_events',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column('agent_name', sa.String(255), nullable=False),
        sa.Column('task_summary', sa.Text, nullable=False),
        sa.Column(
            'collection_id',
            sa.Text,
            sa.ForeignKey('collections.name', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('skill_ids', JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('resolver_confidence', sa.Float, nullable=True),
        sa.Column('risk_level', sa.String(32), nullable=True),
        sa.Column('outcome', sa.String(32), nullable=True),
        sa.Column('channel', sa.String(64), nullable=True),
        sa.Column('metadata_json', JSONB, nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index('ix_skill_usage_events_created_at', 'skill_usage_events', ['created_at'])
    op.create_index('ix_skill_usage_events_collection_id', 'skill_usage_events', ['collection_id'])

    # d. Extend comments table
    op.add_column('comments', sa.Column('author_type', sa.String(16), nullable=False, server_default='human'))
    # Drop server_default after backfill so future inserts must be explicit
    op.alter_column('comments', 'author_type', server_default=None)
    op.add_column('comments', sa.Column('comment_type', sa.String(64), nullable=True))
    op.add_column('comments', sa.Column('rating', sa.Integer, nullable=True))
    op.add_column('comments', sa.Column('linked_usage_id', UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_comments_linked_usage_id',
        'comments',
        'skill_usage_events',
        ['linked_usage_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    # Exact reverse order
    op.drop_constraint('fk_comments_linked_usage_id', 'comments', type_='foreignkey')
    op.drop_column('comments', 'linked_usage_id')
    op.drop_column('comments', 'rating')
    op.drop_column('comments', 'comment_type')
    op.drop_column('comments', 'author_type')

    op.drop_index('ix_skill_usage_events_collection_id', table_name='skill_usage_events')
    op.drop_index('ix_skill_usage_events_created_at', table_name='skill_usage_events')
    op.drop_table('skill_usage_events')

    op.execute("DROP INDEX IF EXISTS ix_skills_embedding_hnsw")
    op.drop_column('skills', 'embedding')

    op.execute("DROP EXTENSION IF EXISTS vector")
