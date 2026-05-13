"""0018 agent_disconnects — record explicit disconnect events

The Connect page's "Disconnect" action used to DELETE all `agent_installs`
rows for the agent and call it done. But the state-derivation logic at
`_agent_status` treats an agent as "active" if there's ANY recent
`skill_call_events` row in the last 24h. Result: clicking Disconnect did
nothing observable when recent activity existed — the agent stayed in
the Connected tab. This table lets the derivation filter out activity
that predates the user's explicit disconnect.

Revision ID: 0018_agent_disconnects
Revises: 0017_agent_installs
Create Date: 2026-05-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0018_agent_disconnects"
down_revision = "0017_agent_installs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_disconnects",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("agent", sa.Text(), nullable=False),
        sa.Column(
            "disconnected_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_agent_disconnects_agent_disconnected_at",
        "agent_disconnects",
        ["agent", "disconnected_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_agent_disconnects_agent_disconnected_at",
        table_name="agent_disconnects",
    )
    op.drop_table("agent_disconnects")
