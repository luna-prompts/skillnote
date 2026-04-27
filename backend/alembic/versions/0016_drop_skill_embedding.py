"""0016 drop skill embedding — reverse the pgvector parts of 0015

The OpenClaw resolver subagent runs in the agent harness with full LLM
reasoning over the skill catalog. It does the relevance picking — SkillNote
just ships the universe. We don't need server-side semantic ranking, so:

- DROP INDEX ix_skills_embedding_hnsw
- DROP COLUMN skills.embedding
- DROP EXTENSION vector

The other parts 0015 added (skill_usage_events, comments extension) are
KEPT — those still serve usage logging + agent reflections.

Revision ID: 0016_drop_skill_embedding
Revises: 0015_openclaw_foundation
Create Date: 2026-04-26
"""

from alembic import op
import sqlalchemy as sa


revision = "0016_drop_skill_embedding"
down_revision = "0015_openclaw_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_skills_embedding_hnsw")
    # 0015 was made replay-safe — it skips the embedding column on
    # postgres images that don't ship pgvector. So the column may or may
    # not exist here. Use raw SQL with IF EXISTS instead of
    # `op.drop_column`, which doesn't accept that flag.
    op.execute("ALTER TABLE skills DROP COLUMN IF EXISTS embedding")
    # No other code uses pgvector now — drop the extension too so a fresh
    # postgres:16 image (which doesn't bundle pgvector) can host the schema.
    op.execute("DROP EXTENSION IF EXISTS vector")


def downgrade() -> None:
    # Mirror what 0015 did for embedding. Requires pgvector to be available
    # in the postgres image (e.g. pgvector/pgvector:pg16); a vanilla
    # postgres:16 will fail at CREATE EXTENSION.
    from pgvector.sqlalchemy import Vector

    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column(
        "skills",
        sa.Column("embedding", Vector(1536), nullable=True),
    )
    op.execute(
        "CREATE INDEX ix_skills_embedding_hnsw "
        "ON skills USING hnsw (embedding vector_cosine_ops)"
    )
