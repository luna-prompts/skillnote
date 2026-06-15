"""0019 claude_ai_integration — tables for the claude.ai connector

Adds three tables that power the browser-extension-driven sync between
self-hosted SkillNote and a user's claude.ai account:

  * claude_ai_integrations    — one row per paired browser/extension
  * claude_ai_skill_links     — mapping SkillNote skill <-> claude.ai skill
  * claude_ai_sync_operations — work queue the extension drains

Enum-like columns use Text + CHECK constraints (matching the project's
convention seen in agent_install, skill_usage_events, etc.) rather than
PostgreSQL ENUM types. This keeps schema migrations cheap when we add a
new state — no ALTER TYPE dance, just update the CHECK constraint.

See docs/claude-ai-integration.md for the full design.

Revision ID: 0019_claude_ai_integration
Revises: 0018_agent_disconnects
Create Date: 2026-05-24
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "0019_claude_ai_integration"
down_revision = "0018_agent_disconnects"
branch_labels = None
depends_on = None


# Valid values for each enum-like column. Mirrors the Pydantic Literal[]
# unions in app/schemas/claude_ai.py — keep them in sync.
INTEGRATION_STATUS_VALUES = (
    "pending_approval", "active", "cookie_expired", "disconnected", "error",
)
INTEGRATION_SCOPE_VALUES = ("personal", "organization", "both")
INTEGRATION_CONFLICT_POLICY_VALUES = ("ask", "skillnote_wins", "claude_ai_wins")
LINK_DIRECTION_VALUES = ("outbound", "inbound", "both")
LINK_CONFLICT_VALUES = ("none", "diverged", "resolved")
OP_KIND_VALUES = ("upload", "update", "delete", "list", "fetch_one")
OP_STATUS_VALUES = ("pending", "in_progress", "completed", "failed")


def _check_in(column: str, values: tuple[str, ...]) -> str:
    """Build a SQL CHECK clause for `column IN (...)`."""
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({quoted})"


def upgrade() -> None:
    # ── claude_ai_integrations ────────────────────────────────────────────────
    # One row per paired browser. Tokens are stored hashed (sha256 hex digest);
    # the raw values only ever live on the extension side.
    op.create_table(
        "claude_ai_integrations",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        # FK reserved for when ACL ships; nullable today because skillnote
        # currently has no auth (see CLAUDE.md). Indexed so per-user lookups
        # remain cheap when populated.
        sa.Column("user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False, server_default="both"),
        # Discovered from claude.ai on the first successful sync via the
        # extension. Nullable until that first round-trip completes.
        sa.Column("claude_ai_org_id", sa.Text(), nullable=True),
        # Human-readable label the extension supplies at pair time
        # (e.g. "Chrome on MacBook Pro"). Used in the connected-browsers list.
        sa.Column("browser_label", sa.Text(), nullable=True),
        # Pairing handshake — short human code shown in extension, opaque
        # polling token held by the extension. Both nulled out once redeemed.
        sa.Column("pairing_code", sa.Text(), nullable=True),
        sa.Column("pairing_token_hash", sa.Text(), nullable=True),
        sa.Column("pairing_expires_at", sa.DateTime(timezone=True), nullable=True),
        # Set by the user-approval call; consumed by the extension's next
        # /pair/status poll. The presence of this timestamp (with status
        # still `pending_approval`) means "approved but the extension hasn't
        # picked up its token yet."
        sa.Column("pairing_approved_at", sa.DateTime(timezone=True), nullable=True),
        # Long-lived bearer the extension sends on every request after pairing.
        # Stored hashed; raw value never persisted server-side after issuance.
        sa.Column("extension_token_hash", sa.Text(), nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("conflict_policy", sa.Text(), nullable=False, server_default="ask"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            _check_in("status", INTEGRATION_STATUS_VALUES),
            name="ck_claude_ai_integrations_status",
        ),
        sa.CheckConstraint(
            _check_in("scope", INTEGRATION_SCOPE_VALUES),
            name="ck_claude_ai_integrations_scope",
        ),
        sa.CheckConstraint(
            _check_in("conflict_policy", INTEGRATION_CONFLICT_POLICY_VALUES),
            name="ck_claude_ai_integrations_conflict_policy",
        ),
    )
    # Token lookups happen on every extension request — hot path.
    op.create_index(
        "ix_claude_ai_integrations_extension_token_hash",
        "claude_ai_integrations",
        ["extension_token_hash"],
        unique=True,
        postgresql_where=sa.text("extension_token_hash IS NOT NULL"),
    )
    op.create_index(
        "ix_claude_ai_integrations_pairing_token_hash",
        "claude_ai_integrations",
        ["pairing_token_hash"],
        unique=True,
        postgresql_where=sa.text("pairing_token_hash IS NOT NULL"),
    )
    # SkillNote UI lists integrations by status + last_sync_at; index supports
    # the per-user filtered list view efficiently.
    op.create_index(
        "ix_claude_ai_integrations_user_id_status",
        "claude_ai_integrations",
        ["user_id", "status"],
    )

    # ── claude_ai_skill_links ─────────────────────────────────────────────────
    # The mapping table. One row per (integration, skill) pair that's been
    # observed on either side. Skill_id is nullable because a claude.ai-authored
    # skill may exist as a link before the import op creates the SkillNote row.
    op.create_table(
        "claude_ai_skill_links",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "integration_id",
            UUID(as_uuid=True),
            sa.ForeignKey("claude_ai_integrations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "skillnote_skill_id",
            UUID(as_uuid=True),
            sa.ForeignKey("skills.id", ondelete="CASCADE"),
            nullable=True,
        ),
        # Last version we successfully pushed. SET NULL on version delete
        # because version pruning shouldn't break the link (the latest version
        # will repopulate on the next sync tick).
        sa.Column(
            "skillnote_version_id",
            UUID(as_uuid=True),
            sa.ForeignKey("skill_content_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("claude_ai_skill_id", sa.Text(), nullable=False),
        sa.Column("claude_ai_version", sa.Text(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("direction", sa.Text(), nullable=False, server_default="both"),
        sa.Column(
            "conflict_state", sa.Text(), nullable=False, server_default="none"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # A given claude.ai skill ID can only be linked once per integration.
        # Without this, retries or list-then-upload races could double-insert.
        sa.UniqueConstraint(
            "integration_id",
            "claude_ai_skill_id",
            name="uq_claude_ai_skill_links_integration_claude_skill",
        ),
        sa.CheckConstraint(
            _check_in("direction", LINK_DIRECTION_VALUES),
            name="ck_claude_ai_skill_links_direction",
        ),
        sa.CheckConstraint(
            _check_in("conflict_state", LINK_CONFLICT_VALUES),
            name="ck_claude_ai_skill_links_conflict_state",
        ),
    )
    # Lookup by skillnote_skill_id is used when enqueueing sync ops on
    # skill publish — needs to fan out to every linked integration.
    op.create_index(
        "ix_claude_ai_skill_links_skillnote_skill_id",
        "claude_ai_skill_links",
        ["skillnote_skill_id"],
    )
    op.create_index(
        "ix_claude_ai_skill_links_integration_id_conflict",
        "claude_ai_skill_links",
        ["integration_id", "conflict_state"],
    )

    # ── claude_ai_sync_operations ─────────────────────────────────────────────
    # Append-only queue. Extension polls /extension/operations for pending ops,
    # executes them, then calls /complete to set status. Failed ops can be
    # retried via attempts counter; >N attempts means surface to the user.
    op.create_table(
        "claude_ai_sync_operations",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "integration_id",
            UUID(as_uuid=True),
            sa.ForeignKey("claude_ai_integrations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column(
            "skill_id",
            UUID(as_uuid=True),
            sa.ForeignKey("skills.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("payload", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            _check_in("kind", OP_KIND_VALUES),
            name="ck_claude_ai_sync_operations_kind",
        ),
        sa.CheckConstraint(
            _check_in("status", OP_STATUS_VALUES),
            name="ck_claude_ai_sync_operations_status",
        ),
    )
    # The extension's poll query is `WHERE integration_id = ? AND status =
    # 'pending' ORDER BY created_at LIMIT n` — this composite covers it.
    op.create_index(
        "ix_claude_ai_sync_operations_integration_status_created",
        "claude_ai_sync_operations",
        ["integration_id", "status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_claude_ai_sync_operations_integration_status_created",
        table_name="claude_ai_sync_operations",
    )
    op.drop_table("claude_ai_sync_operations")

    op.drop_index(
        "ix_claude_ai_skill_links_integration_id_conflict",
        table_name="claude_ai_skill_links",
    )
    op.drop_index(
        "ix_claude_ai_skill_links_skillnote_skill_id",
        table_name="claude_ai_skill_links",
    )
    op.drop_table("claude_ai_skill_links")

    op.drop_index(
        "ix_claude_ai_integrations_user_id_status",
        table_name="claude_ai_integrations",
    )
    op.drop_index(
        "ix_claude_ai_integrations_pairing_token_hash",
        table_name="claude_ai_integrations",
    )
    op.drop_index(
        "ix_claude_ai_integrations_extension_token_hash",
        table_name="claude_ai_integrations",
    )
    op.drop_table("claude_ai_integrations")
