"""Pydantic request/response schemas for /v1/import/* endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class InspectRequest(BaseModel):
    input: str = Field(..., min_length=1)
    github_token: Optional[str] = None
    subpath: Optional[str] = None


class InspectSkill(BaseModel):
    name: str
    description: Optional[str] = None
    path: Optional[str] = None
    content_hash: Optional[str] = None
    license: Optional[str] = None


class InspectResponseSource(BaseModel):
    source_type: str
    url: Optional[str] = None
    host: Optional[str] = None
    owner: Optional[str] = None
    repo: Optional[str] = None
    ref: Optional[str] = None
    resolved_sha: Optional[str] = None
    subpath: Optional[str] = None


class InspectResponse(BaseModel):
    source: InspectResponseSource
    kind: Optional[str] = None
    skills: List[InspectSkill] = []
    manifest: Optional[dict] = None
    warnings: List[dict] = []
    suggested_collection_slug: Optional[str] = None
    existing_source_id: Optional[str] = None


class ApplyRequest(BaseModel):
    input: str = Field(..., min_length=1)
    github_token: Optional[str] = None
    ref: Optional[str] = None
    subpath: Optional[str] = None
    target_collection_slug: Optional[str] = None
    skill_selection: Optional[List[str]] = None  # None = all
    on_conflict: Literal["rename", "skip", "replace"] = "rename"


class ApplyResponseSkill(BaseModel):
    name: str
    slug: str
    original_name: Optional[str] = None
    renamed_reason: Optional[str] = None


class ApplyResponse(BaseModel):
    source_id: str
    collection_slug: str
    imported: List[ApplyResponseSkill]
    skipped: List[dict] = []


class SourceListItem(BaseModel):
    id: str
    url: str
    host: Optional[str] = None
    owner: Optional[str] = None
    repo: Optional[str] = None
    ref: Optional[str] = None
    kind: str
    collection_slug: str
    pinned: bool
    imported_at_sha: Optional[str] = None
    upstream_sha: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    last_checked_at: Optional[datetime] = None
    status: str
    skill_count: int
    drift_summary: Optional[dict] = None
