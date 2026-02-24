from pydantic import BaseModel


class SkillListItem(BaseModel):
    name: str
    slug: str
    description: str
    latestVersion: str | None = None
    status: str | None = None
    channel: str | None = None
