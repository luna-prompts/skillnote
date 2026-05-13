"""AgentInstall — records every successful install of a SkillNote agent.

The Connect page surfaces a per-agent state machine:
  pending     — no install ping, no analytics → show install command
  installed   — install ping received, no skill calls yet → show "waiting for first task"
  active      — install ping received AND recent skill call → show "connected"
  idle        — install pinged in the past, no recent activity

The `installed` state cannot be derived from analytics alone: a user can
install but never invoke a skill, and we still want to show them they're
"set up." This table provides the ground-truth installed signal: the install
script's final line POSTs here with the agent name and a stable machine_id
hash.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AgentInstall(Base):
    __tablename__ = "agent_installs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Canonical agent name. Constrained at the application layer to the
    # union we currently support (claude-code, openclaw); kept as TEXT in
    # the DB so we can add agents without a schema migration.
    agent: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    # SHA-256 hex digest of a stable per-machine identifier — never the raw
    # value. Lets us count distinct installs without storing PII.
    machine_id_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Version of the agent's SkillNote plugin/skill that was installed
    # (e.g. plugin VERSION file content).
    version: Mapped[str | None] = mapped_column(Text, nullable=True)
    installed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # Speed up the latest-install-per-agent query on the Connect page.
        Index("ix_agent_installs_agent_installed_at", "agent", "installed_at"),
    )
