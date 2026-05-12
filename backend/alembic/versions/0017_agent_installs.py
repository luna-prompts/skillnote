"""0017 agent_installs — track install ping per agent

Adds the `agent_installs` table that the Connect page's state machine
needs to distinguish "installed but no skill calls yet" from "never
installed." The install scripts emit a final `POST /v1/setup/installs`
when they succeed.

Revision ID: 0017_agent_installs
Revises: 0016_drop_skill_embedding
Create Date: 2026-05-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0017_agent_installs"
down_revision = "0016_drop_skill_embedding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_installs",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("agent", sa.Text(), nullable=False),
        sa.Column("machine_id_hash", sa.Text(), nullable=True),
        sa.Column("version", sa.Text(), nullable=True),
        sa.Column(
            "installed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_agent_installs_agent",
        "agent_installs",
        ["agent"],
    )
    op.create_index(
        "ix_agent_installs_agent_installed_at",
        "agent_installs",
        ["agent", "installed_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_installs_agent_installed_at", table_name="agent_installs")
    op.drop_index("ix_agent_installs_agent", table_name="agent_installs")
    op.drop_table("agent_installs")
