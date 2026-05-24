"""Claude.ai connector models.

Three closely-related tables cluster the integration state:

  * ClaudeAIIntegration    — one row per paired browser/extension; stores
                              hashed tokens + sync scope + status.
  * ClaudeAISkillLink      — mapping SkillNote skill <-> claude.ai skill,
                              including conflict state.
  * ClaudeAISyncOperation  — append-only work queue the extension drains.

See docs/claude-ai-integration.md for the design rationale.

Token storage: extension_token and pairing_token are kept as **sha256 hex
hashes**, never the raw values. The raw token only exists on the wire
(returned to the extension once at issuance) and inside the extension's
local `chrome.storage.local`. A DB dump cannot replay sessions.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    Index,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ClaudeAIIntegration(Base):
    __tablename__ = "claude_ai_integrations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Nullable until ACL lands; per memory `[CLAUDE.md drift]` and the no-auth
    # note in the project README, skillnote currently has no user model.
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )

    # `pending_approval` | `active` | `cookie_expired` | `disconnected` | `error`
    # Kept as Text in the model (matching the PG enum on the wire) — keeps the
    # Python type simple. App layer constrains the allowed values via Pydantic.
    status: Mapped[str] = mapped_column(Text, nullable=False)
    scope: Mapped[str] = mapped_column(Text, nullable=False, default="both")

    claude_ai_org_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    browser_label: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Pairing handshake — populated while status='pending_approval', nulled
    # after redemption. The raw pairing_code is shown to the user; the raw
    # pairing_token is held by the extension. The DB only sees the hashes.
    pairing_code: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    pairing_token_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    pairing_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Set by /pair/approve; consumed and cleared by the extension's next
    # /pair/status poll (which atomically issues the extension token and
    # flips status to 'active'). Lets the Device Code Flow stay cleanly
    # stateless without stashing raw tokens in any column.
    pairing_approved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Long-lived bearer token (hashed) the extension sends on every API call
    # after the pairing is approved. Compared via constant-time hash equality
    # in the auth dependency.
    extension_token_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    last_sync_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # `ask` (default) | `skillnote_wins` | `claude_ai_wins`
    conflict_policy: Mapped[str] = mapped_column(Text, nullable=False, default="ask")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        Index(
            "ix_claude_ai_integrations_user_id_status",
            "user_id",
            "status",
        ),
    )


class ClaudeAISkillLink(Base):
    __tablename__ = "claude_ai_skill_links"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    integration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("claude_ai_integrations.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Nullable so a claude.ai-authored skill can exist as a link record before
    # the inbound import op materializes the SkillNote skill row.
    skillnote_skill_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("skills.id", ondelete="CASCADE"),
        nullable=True,
    )
    # SET NULL on version-row delete: pruning stale versions shouldn't break
    # the link; the next outbound op repopulates from the current latest.
    skillnote_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("skill_content_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    claude_ai_skill_id: Mapped[str] = mapped_column(Text, nullable=False)
    claude_ai_version: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # `outbound` | `inbound` | `both`
    direction: Mapped[str] = mapped_column(Text, nullable=False, default="both")
    # `none` | `diverged` | `resolved`
    conflict_state: Mapped[str] = mapped_column(Text, nullable=False, default="none")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "integration_id",
            "claude_ai_skill_id",
            name="uq_claude_ai_skill_links_integration_claude_skill",
        ),
        Index(
            "ix_claude_ai_skill_links_skillnote_skill_id",
            "skillnote_skill_id",
        ),
        Index(
            "ix_claude_ai_skill_links_integration_id_conflict",
            "integration_id",
            "conflict_state",
        ),
    )


class ClaudeAISyncOperation(Base):
    __tablename__ = "claude_ai_sync_operations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    integration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("claude_ai_integrations.id", ondelete="CASCADE"),
        nullable=False,
    )
    # `upload` | `update` | `delete` | `list` | `fetch_one`
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    # Nullable for `list` ops (which don't target a single skill).
    skill_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("skills.id", ondelete="CASCADE"),
        nullable=True,
    )
    # Op-specific payload. For upload: { "version_id": "...", "name": "...",
    # "description": "...", "zip_url": "..." }. For delete: { "claude_ai_skill_id": "..." }.
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # `pending` | `in_progress` | `completed` | `failed`
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index(
            "ix_claude_ai_sync_operations_integration_status_created",
            "integration_id",
            "status",
            "created_at",
        ),
    )
