"""Pydantic request/response schemas for /v1/import/* endpoints."""
from __future__ import annotations

from typing import List, Optional
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
