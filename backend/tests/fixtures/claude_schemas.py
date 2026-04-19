"""Python port of Claude Code's marketplace.json Zod schemas (from claude-code-source/src/utils/plugins/schemas.ts).

Used to cross-validate publisher output: ensure what SkillNote publishes can actually
be parsed and consumed by Claude Code.

Kept isolated to tests/fixtures/ — not a production dependency.
"""
from __future__ import annotations

from typing import List, Literal, Optional, Union

from pydantic import BaseModel, Field


class ClaudeOwner(BaseModel):
    name: str
    email: Optional[str] = None
    url: Optional[str] = None


class ClaudeMetadata(BaseModel):
    description: Optional[str] = None
    version: Optional[str] = None


class GitHubSource(BaseModel):
    source: Literal["github"]
    repo: str  # "owner/repo"
    ref: Optional[str] = None
    sha: Optional[str] = None
    path: Optional[str] = None


class GitSubdirSource(BaseModel):
    source: Literal["git-subdir"]
    url: str  # git-clonable URL
    path: str
    ref: Optional[str] = None
    sha: Optional[str] = None


class UrlSource(BaseModel):
    source: Literal["url"]
    url: str
    ref: Optional[str] = None
    sha: Optional[str] = None


ClaudePluginSource = Union[str, GitHubSource, GitSubdirSource, UrlSource]


class ClaudePlugin(BaseModel):
    name: str
    source: ClaudePluginSource
    description: Optional[str] = None
    version: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    homepage: Optional[str] = None
    license: Optional[str] = None


class ClaudeMarketplace(BaseModel):
    name: str
    owner: ClaudeOwner
    metadata: Optional[ClaudeMetadata] = None
    plugins: List[ClaudePlugin]
    # Also tolerate $schema (unused but common)
    schema_url: Optional[str] = Field(default=None, alias="$schema")

    model_config = {"populate_by_name": True}
