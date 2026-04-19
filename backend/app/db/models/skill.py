import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, false as sa_false, func
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Skill(Base):
    __tablename__ = "skills"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    content_md: Mapped[str] = mapped_column(Text, nullable=True, default="")
    collections: Mapped[List[str]] = mapped_column(ARRAY(Text), nullable=True, default=list)
    current_version: Mapped[int] = mapped_column(Integer, nullable=True, default=0)
    extra_frontmatter: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default=None)
    import_source_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("import_sources.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_sha: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    source_content_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    forked_from_source: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=sa_false()
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    comments: Mapped[list["Comment"]] = relationship("Comment", back_populates="skill", cascade="all, delete-orphan")
