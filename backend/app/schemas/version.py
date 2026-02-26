from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class SkillVersionItem(BaseModel):
    version: str
    checksumSha256: str
    status: str
    channel: str
    publishedAt: datetime
    releaseNotes: str | None = None


class ContentVersionItem(BaseModel):
    version: int
    title: str
    description: str
    content_md: str
    tags: List[str] = []
    collections: List[str] = []
    is_latest: bool
    created_at: datetime

    model_config = {"from_attributes": True}
