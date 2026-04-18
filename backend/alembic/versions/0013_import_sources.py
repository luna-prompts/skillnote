"""0013 import_sources + skill columns

Revision ID: 0013_import_sources
Revises: 0012_slugify_collection_names
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0013_import_sources"
down_revision = "0012_slugify_collection_names"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    source_type_enum = postgresql.ENUM(
        "github", "git", "url", "git_subdir", "file", "directory",
        name="import_source_type",
        create_type=False,
    )
    kind_enum = postgresql.ENUM(
        "marketplace", "plugin", "skill_bundle", "single_skill",
        name="import_source_kind",
        create_type=False,
    )
    status_enum = postgresql.ENUM(
        "up_to_date", "drift", "unreachable", "error",
        name="import_source_status",
        create_type=False,
    )
    # Create ENUM types explicitly (idempotent); tables below reference them
    # with create_type=False so the column-level DDL won't try to recreate them.
    source_type_enum.create(bind, checkfirst=True)
    kind_enum.create(bind, checkfirst=True)
    status_enum.create(bind, checkfirst=True)

    op.create_table(
        "import_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("source_type", source_type_enum, nullable=False),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("host", sa.Text),
        sa.Column("owner", sa.Text),
        sa.Column("repo", sa.Text),
        sa.Column("subpath", sa.Text),
        sa.Column("ref", sa.Text),
        sa.Column("kind", kind_enum, nullable=False),
        sa.Column("collection_name", sa.Text,
                  sa.ForeignKey("collections.name", ondelete="CASCADE"), nullable=False),
        sa.Column("pinned", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("imported_at_sha", sa.String(40)),
        sa.Column("upstream_sha", sa.String(40)),
        sa.Column("last_checked_at", sa.DateTime(timezone=True)),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column("status", status_enum, nullable=False, server_default="up_to_date"),
        sa.Column("last_error", sa.String(1024)),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_unique_constraint(
        "uq_import_sources_canonical", "import_sources",
        ["url", "ref", "subpath"],
    )
    op.create_index(
        "ix_import_sources_status_checked", "import_sources",
        ["status", "last_checked_at"],
    )
    op.create_index(
        "ix_import_sources_collection", "import_sources",
        ["collection_name"],
    )

    op.add_column("skills", sa.Column(
        "import_source_id", postgresql.UUID(as_uuid=True),
        sa.ForeignKey("import_sources.id", ondelete="SET NULL"), nullable=True,
    ))
    op.add_column("skills", sa.Column("source_path", sa.Text, nullable=True))
    op.add_column("skills", sa.Column("source_sha", sa.String(40), nullable=True))
    op.add_column("skills", sa.Column("source_content_hash", sa.String(64), nullable=True))
    op.add_column("skills", sa.Column(
        "forked_from_source", sa.Boolean, nullable=False, server_default=sa.false(),
    ))
    op.create_index("ix_skills_import_source", "skills", ["import_source_id"])


def downgrade() -> None:
    op.drop_index("ix_skills_import_source", table_name="skills")
    op.drop_column("skills", "forked_from_source")
    op.drop_column("skills", "source_content_hash")
    op.drop_column("skills", "source_sha")
    op.drop_column("skills", "source_path")
    op.drop_column("skills", "import_source_id")

    op.drop_index("ix_import_sources_collection", table_name="import_sources")
    op.drop_index("ix_import_sources_status_checked", table_name="import_sources")
    op.drop_constraint("uq_import_sources_canonical", "import_sources", type_="unique")
    op.drop_table("import_sources")

    op.execute("DROP TYPE IF EXISTS import_source_status")
    op.execute("DROP TYPE IF EXISTS import_source_kind")
    op.execute("DROP TYPE IF EXISTS import_source_type")
