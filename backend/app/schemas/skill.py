from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel
import uuid


class SkillListItem(BaseModel):
    name: str
    slug: str
    description: str
    latestVersion: Optional[str] = None
    status: Optional[str] = None
    channel: Optional[str] = None


class SkillDetail(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str
    content_md: Optional[str] = ""
    tags: List[str] = []
    collections: List[str] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SkillCreate(BaseModel):
    name: str
    slug: str
    description: str = ""
    content_md: str = ""
    tags: List[str] = []
    collections: List[str] = []


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    content_md: Optional[str] = None
    tags: Optional[List[str]] = None
    collections: Optional[List[str]] = None
