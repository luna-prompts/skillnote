"""Add skill_call_events.session_name.

The human chat/session title (e.g. a claude.ai conversation name, captured by
the connector extension) so the analytics "Recent chats" panel can show
"Refactor auth flow" instead of an opaque session id. Nullable — sources with
no title (CLI runs) leave it NULL.

Revision ID: 0027_event_session_name
Revises: 0026_link_staged_version
Create Date: 2026-06-07
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0027_event_session_name"
down_revision = "0026_link_staged_version"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "skill_call_events",
        sa.Column("session_name", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("skill_call_events", "session_name")
