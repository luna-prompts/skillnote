"""Pydantic models mirroring Claude Code's marketplace.json + SKILL.md frontmatter.

Reference: claude-code-source/src/utils/plugins/schemas.ts
"""
from __future__ import annotations

import re
from typing import List, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator


SKILL_NAME_RE = re.compile(r"^[a-z0-9-]+$")
RESERVED_WORDS = ("anthropic", "claude")


class ManifestError(Exception):
    """Raised when a manifest is structurally invalid."""


class Owner(BaseModel):
    name: str
    email: Optional[str] = None


class Metadata(BaseModel):
    description: Optional[str] = None
    version: Optional[str] = None
    pluginRoot: Optional[str] = None


# Plugin source variants
class GitHubPluginSource(BaseModel):
    source: Literal["github"]
    repo: str
    ref: Optional[str] = None
    sha: Optional[str] = None
    path: Optional[str] = None


class UrlPluginSource(BaseModel):
    source: Literal["url"]
    url: str
    ref: Optional[str] = None
    sha: Optional[str] = None


class GitSubdirPluginSource(BaseModel):
    source: Literal["git-subdir"]
    url: str
    path: str = Field(min_length=1)
    ref: Optional[str] = None
    sha: Optional[str] = None


PluginSource = Union[
    str,  # relative path
    GitHubPluginSource,
    UrlPluginSource,
    GitSubdirPluginSource,
]


class Plugin(BaseModel):
    name: str
    source: PluginSource
    description: Optional[str] = None
    version: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    homepage: Optional[str] = None
    license: Optional[str] = None


class Marketplace(BaseModel):
    schema_url: Optional[str] = Field(default=None, alias="$schema")
    name: str
    owner: Owner
    metadata: Optional[Metadata] = None
    plugins: List[Plugin]


class SkillFrontmatter(BaseModel):
    name: str
    description: str
    license: Optional[str] = None
    compatibility: Optional[str] = None
    metadata: Optional[dict] = None
    allowed_tools: Optional[List[str]] = Field(default=None, alias="allowed-tools")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not v or not isinstance(v, str):
            raise ValueError("Name required")
        if len(v) > 64:
            raise ValueError(f"Name must be <=64 chars (got {len(v)})")
        if not SKILL_NAME_RE.match(v):
            raise ValueError("Name must match ^[a-z0-9-]+$")
        for word in RESERVED_WORDS:
            if word in v:
                raise ValueError(f"Name cannot contain reserved word '{word}'")
        return v

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: str) -> str:
        if not v:
            raise ValueError("Description required")
        if len(v) > 1024:
            raise ValueError(f"Description must be <=1024 chars (got {len(v)})")
        return v
