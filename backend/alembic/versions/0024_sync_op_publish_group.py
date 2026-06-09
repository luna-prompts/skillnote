"""Allow the 'publish_group' sync op kind.

The claude.ai connector moves from per-skill uploads to a single named-group
publish: one ``publish_group`` op rebuilds the whole "SkillNote" plugin and
re-uploads it (account-upload, overwrite=true). The CHECK constraint on
``claude_ai_sync_operations.kind`` (from 0019) must permit the new value.

Revision ID: 0024_sync_op_publish_group
Revises: 0023_audit_ops_events
"""
from alembic import op

revision = "0024_sync_op_publish_group"
down_revision = "0023_audit_ops_events"
branch_labels = None
depends_on = None

_CONSTRAINT = "ck_claude_ai_sync_operations_kind"
_TABLE = "claude_ai_sync_operations"

_OLD = ("upload", "update", "delete", "list", "fetch_one")
_NEW = ("upload", "update", "delete", "list", "fetch_one", "publish_group")


def _check(values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"kind IN ({quoted})"


def upgrade() -> None:
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(_CONSTRAINT, _TABLE, _check(_NEW))


def downgrade() -> None:
    # Drop any rows using the new kind so the tighter constraint can re-apply.
    op.execute(f"DELETE FROM {_TABLE} WHERE kind = 'publish_group'")
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(_CONSTRAINT, _TABLE, _check(_OLD))
