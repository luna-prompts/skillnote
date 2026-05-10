from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, field_validator
import uuid

from app.validators.skill_validator import validate_skill_name, validate_skill_description, validate_collections


class SkillOrigin(BaseModel):
    """Where a skill came from — attached when the skill was imported from an upstream."""

    source_type: str                      # "github" | "git" | "url" | ...
    host: Optional[str] = None            # e.g. "github.com"
    owner: Optional[str] = None           # e.g. "wshobson"
    repo: Optional[str] = None            # e.g. "agents"
    subpath: Optional[str] = None         # folder within the repo
    ref: Optional[str] = None             # branch/tag at import time
    path: Optional[str] = None            # path to the SKILL.md in-repo
    sha: Optional[str] = None             # commit SHA at import time
    url: Optional[str] = None             # deep link to the file on GitHub (when derivable)
    forked: bool = False                  # user has edited since import


class SkillListItem(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    slug: str
    description: str
    collections: List[str] = []
    latestVersion: Optional[str] = None
    status: Optional[str] = None
    channel: Optional[str] = None
    currentVersion: int = 0
    content_md: Optional[str] = ""
    extra_frontmatter: Optional[str] = None
    origin: Optional[SkillOrigin] = None


class SkillDetail(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str
    content_md: Optional[str] = ""
    collections: List[str] = []
    current_version: int = 0
    total_versions: int = 0
    extra_frontmatter: Optional[str] = None
    origin: Optional[SkillOrigin] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SkillCreate(BaseModel):
    name: str
    slug: str
    description: str
    content_md: str = ""
    collections: List[str]
    extra_frontmatter: Optional[str] = None

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

    @field_validator("collections")
    @classmethod
    def check_collections(cls, v: List[str]) -> List[str]:
        errors = validate_collections(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    content_md: Optional[str] = None
    collections: Optional[List[str]] = None
    extra_frontmatter: Optional[str] = None

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

    @field_validator("collections")
    @classmethod
    def check_collections(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return v
        errors = validate_collections(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v
