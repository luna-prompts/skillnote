"""Add claude_ai_skill_links.staged_version_id.

Stores the inbound SkillContentVersion staged on a `diverged_ask` conflict so
`resolve_conflict` loads the EXACT staged row instead of guessing via a
"newest non-latest version" created_at heuristic. The heuristic broke whenever
an intervening save/restore/re-import created a newer non-latest row — it would
then promote or hard-delete the wrong version (silent history loss). See H1.

Revision ID: 0026_link_staged_version
Revises: 0025_collection_publish_ca
Create Date: 2026-06-07
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "0026_link_staged_version"
down_revision = "0025_collection_publish_ca"
branch_labels = None
depends_on = None

_TABLE = "claude_ai_skill_links"
_COL = "staged_version_id"
_FK = "fk_claude_ai_skill_links_staged_version"


def upgrade() -> None:
    op.add_column(
        _TABLE,
        sa.Column(_COL, UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        _FK,
        _TABLE,
        "skill_content_versions",
        [_COL],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(_FK, _TABLE, type_="foreignkey")
    op.drop_column(_TABLE, _COL)
