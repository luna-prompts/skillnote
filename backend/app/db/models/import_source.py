from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean, DateTime, Enum, ForeignKey, Index, String, Text, UniqueConstraint,
    false as sa_false,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


SOURCE_TYPES = ("github", "git", "url", "git_subdir", "file", "directory")
IMPORT_KINDS = ("marketplace", "plugin", "skill_bundle", "single_skill")
IMPORT_STATUSES = ("up_to_date", "drift", "unreachable", "error")


class ImportSource(Base):
    __tablename__ = "import_sources"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    source_type: Mapped[str] = mapped_column(Enum(*SOURCE_TYPES, name="import_source_type"), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    host: Mapped[Optional[str]] = mapped_column(Text)
    owner: Mapped[Optional[str]] = mapped_column(Text)
    repo: Mapped[Optional[str]] = mapped_column(Text)
    subpath: Mapped[str] = mapped_column(Text, nullable=False, server_default="", default="")
    ref: Mapped[Optional[str]] = mapped_column(Text)

    kind: Mapped[str] = mapped_column(Enum(*IMPORT_KINDS, name="import_source_kind"), nullable=False)

    collection_name: Mapped[str] = mapped_column(
        Text, ForeignKey("collections.name", ondelete="CASCADE"), nullable=False
    )

    pinned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=sa_false()
    )

    imported_at_sha: Mapped[Optional[str]] = mapped_column(String(40))
    upstream_sha: Mapped[Optional[str]] = mapped_column(String(40))
    last_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(
        Enum(*IMPORT_STATUSES, name="import_source_status"),
        nullable=False, default="up_to_date", server_default="up_to_date",
    )
    last_error: Mapped[Optional[str]] = mapped_column(String(1024))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("url", "ref", "subpath", name="uq_import_sources_canonical"),
        Index("ix_import_sources_status_checked", "status", "last_checked_at"),
        Index("ix_import_sources_collection", "collection_name"),
    )
