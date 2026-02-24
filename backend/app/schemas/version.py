from datetime import datetime

from pydantic import BaseModel


class SkillVersionItem(BaseModel):
    version: str
    checksumSha256: str
    status: str
    channel: str
    publishedAt: datetime
    releaseNotes: str | None = None
