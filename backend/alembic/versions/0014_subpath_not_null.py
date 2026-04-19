"""0014 import_sources.subpath NOT NULL + dedupe

Fixes Bug #3: Postgres treats NULL != NULL in unique indexes, so the canonical
(url, ref, subpath) uniqueness from migration 0013 never matched when subpath
was NULL. Every re-import of a repo without a subpath created a new row.

This migration:
1. Deduplicates existing import_sources rows keyed on (url, coalesce(ref,''), coalesce(subpath,''))
   keeping the newest row per tuple and nulling out skills.import_source_id for orphans.
2. Sets subpath NOT NULL with server_default '' and backfills NULL → ''.
3. Drops + recreates uq_import_sources_canonical (unchanged shape — now honored).

Revision ID: 0014_subpath_not_null
Revises: 0013_import_sources
Create Date: 2026-04-19
"""
from alembic import op
import sqlalchemy as sa


revision = "0014_subpath_not_null"
down_revision = "0013_import_sources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1) Null-out skills FK for duplicate sources we're about to drop.
    #    Keep the newest row per (url, coalesce(ref,''), coalesce(subpath,'')).
    bind.execute(sa.text("""
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY url, COALESCE(ref, ''), COALESCE(subpath, '')
                       ORDER BY updated_at DESC, created_at DESC
                   ) AS rn
            FROM import_sources
        ),
        losers AS (SELECT id FROM ranked WHERE rn > 1)
        UPDATE skills SET import_source_id = NULL
        WHERE import_source_id IN (SELECT id FROM losers);
    """))

    # 2) Delete the duplicate rows.
    bind.execute(sa.text("""
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY url, COALESCE(ref, ''), COALESCE(subpath, '')
                       ORDER BY updated_at DESC, created_at DESC
                   ) AS rn
            FROM import_sources
        )
        DELETE FROM import_sources
        WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
    """))

    # 3) Backfill NULL subpath → '' so the NOT NULL constraint can land.
    bind.execute(sa.text("UPDATE import_sources SET subpath = '' WHERE subpath IS NULL"))

    # 4) Drop old unique constraint, alter column, recreate constraint.
    op.drop_constraint("uq_import_sources_canonical", "import_sources", type_="unique")
    op.alter_column(
        "import_sources",
        "subpath",
        existing_type=sa.Text(),
        nullable=False,
        server_default="",
    )
    op.create_unique_constraint(
        "uq_import_sources_canonical",
        "import_sources",
        ["url", "ref", "subpath"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_import_sources_canonical", "import_sources", type_="unique")
    op.alter_column(
        "import_sources",
        "subpath",
        existing_type=sa.Text(),
        nullable=True,
        server_default=None,
    )
    op.create_unique_constraint(
        "uq_import_sources_canonical",
        "import_sources",
        ["url", "ref", "subpath"],
    )
