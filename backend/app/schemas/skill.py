from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, field_validator
import uuid

from app.validators.skill_validator import validate_skill_name, validate_skill_description


class SkillListItem(BaseModel):
    name: str
    slug: str
    description: str
    tags: List[str] = []
    collections: List[str] = []
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
    description: str
    content_md: str = ""
    tags: List[str] = []
    collections: List[str] = []

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str) -> str:
        errors = validate_skill_name(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v.strip()

    @field_validator("description")
    @classmethod
    def check_description(cls, v: str) -> str:
        errors = validate_skill_description(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v.strip()


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    content_md: Optional[str] = None
    tags: Optional[List[str]] = None
    collections: Optional[List[str]] = None

    @field_validator("name")
    @classmethod
    def check_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        errors = validate_skill_name(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v.strip()

    @field_validator("description")
    @classmethod
    def check_description(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        errors = validate_skill_description(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v.strip()
