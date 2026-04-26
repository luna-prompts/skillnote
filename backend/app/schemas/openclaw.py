import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class ContextBundleRequest(BaseModel):
    task_summary: str = Field(..., max_length=2000, min_length=1)
    channel: str | None = None
    workspace: str | None = None
    recent_skill_ids: list[uuid.UUID] = Field(default_factory=list)
    max_skills: int = Field(default=20, ge=1, le=100)

    @field_validator("task_summary")
    @classmethod
    def _strip_and_check(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("must not be empty or whitespace")
        return s


class ContextBundleSkill(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    collection_id: str | None
    description: str | None
    rating_avg: float | None
    usage_count_30d: int
    staleness_status: str | None
    recent_comments_summary: str | None

    model_config = {"from_attributes": True}


class ContextBundleCollection(BaseModel):
    name: str
    description: str

    model_config = {"from_attributes": True}


class ContextBundleResponse(BaseModel):
    collections: list[ContextBundleCollection]
    skills: list[ContextBundleSkill]


class UsageEventCreate(BaseModel):
    agent_name: str = Field(..., max_length=255, min_length=1)
    task_summary: str = Field(..., max_length=2000, min_length=1)
    collection_id: str | None = None
    skill_ids: list[uuid.UUID] = Field(default_factory=list)
    resolver_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    risk_level: Literal["low", "medium", "high"] | None = None
    outcome: Literal["completed", "failed", "abandoned", "unknown"] | None = None
    channel: str | None = Field(default=None, max_length=64)
    metadata_json: dict[str, Any] | None = None

    @field_validator("agent_name", "task_summary")
    @classmethod
    def _strip_and_check(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("must not be empty or whitespace")
        return s


class UsageEventOut(BaseModel):
    id: uuid.UUID
    agent_name: str
    task_summary: str
    collection_id: str | None
    # stored as JSON strings; raw to avoid coercion 500s on legacy data
    skill_ids: list[str]
    resolver_confidence: float | None
    risk_level: str | None
    outcome: str | None
    channel: str | None
    metadata_json: dict[str, Any] | None
    created_at: datetime

    model_config = {"from_attributes": True}
