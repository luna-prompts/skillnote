import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, SmallInteger, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SkillRating(Base):
    __tablename__ = "skill_ratings"
    __table_args__ = (
        CheckConstraint("rating >= 1 AND rating <= 5", name="ck_skill_ratings_rating_range"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    skill_slug: Mapped[str] = mapped_column(Text, nullable=False)
    skill_version: Mapped[int] = mapped_column(Integer, nullable=False)
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    agent_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
