"""Polish-layer models for the claude.ai connector.

Lives alongside the core models in claude_ai.py. Split because:
  * The polish layer adds tables for observability (audit log) and security
    (rate-limit attempts) that don't belong in the core domain.
  * Keeps claude_ai.py focused on the integration/link/op data model.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ClaudeAIAuditLog(Base):
    """Append-only event feed for the claude.ai connector.

    Captures every load-bearing transition (pair attempted, approved,
    skills pushed, conflicts detected) with optional skill + integration
    references and a JSONB detail blob for event-specific data.
    """

    __tablename__ = "claude_ai_audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    integration_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("claude_ai_integrations.id", ondelete="CASCADE"),
        nullable=True,
    )
    event: Mapped[str] = mapped_column(Text, nullable=False)
    skill_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("skills.id", ondelete="SET NULL"),
        nullable=True,
    )
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    source_ip: Mapped[Optional[str]] = mapped_column(INET, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index(
            "ix_claude_ai_audit_log_integration_created",
            "integration_id",
            "created_at",
        ),
        Index("ix_claude_ai_audit_log_created_at", "created_at"),
    )


class ClaudeAIPairAttempt(Base):
    """Records pair endpoint hits for rate-limit enforcement.

    Pruning policy: keep ~24h worth — older rows can be dropped by a
    periodic cleanup task. For Phase 1 polish we leave them; if churn
    becomes a concern, an `archive_old_pair_attempts` cron is easy to add.
    """

    __tablename__ = "claude_ai_pair_attempts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    source_ip: Mapped[Optional[str]] = mapped_column(INET, nullable=True)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index(
            "ix_claude_ai_pair_attempts_ip_created",
            "source_ip",
            "created_at",
        ),
        Index("ix_claude_ai_pair_attempts_created_at", "created_at"),
    )
