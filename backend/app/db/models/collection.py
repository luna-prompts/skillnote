from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.db.models.skill_usage_event import SkillUsageEvent


class Collection(Base):
    __tablename__ = "collections"

    name: Mapped[str] = mapped_column(Text, primary_key=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # When True, this collection is published to claude.ai as its own named
    # plugin group ("SkillNote: <name>"). The per-collection toggle lives on
    # the collection card; the connector page stays a light status view.
    published_to_claude_ai: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    usage_events: Mapped[list["SkillUsageEvent"]] = relationship(
        "SkillUsageEvent", back_populates="collection"
    )
