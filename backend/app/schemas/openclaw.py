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
    collection_filter: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
        description=(
            "If provided, only return skills that include this collection name "
            "in their `collections` array. Useful when the agent already has a "
            "collection hint and wants to narrow the catalog before its own "
            "LLM-side ranking pass."
        ),
    )

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
    # Skill.collections is ARRAY(Text); a skill belongs to many collections
    collections: list[str]
    description: str | None
    content_md: str | None
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
    # Either skill_ids (UUIDs) OR skill_slugs may be provided. Slugs are the
    # preferred API for OpenClaw because synced sn-* skills don't expose UUIDs
    # by default. The handler resolves slugs → UUIDs server-side and stores
    # them in skill_ids. Both can be provided; the handler unions them.
    skill_ids: list[uuid.UUID] = Field(default_factory=list)
    skill_slugs: list[str] = Field(default_factory=list, max_length=50)
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

    @field_validator("skill_slugs")
    @classmethod
    def _validate_slugs(cls, v: list[str]) -> list[str]:
        cleaned = []
        for s in v:
            s = s.strip().lower()
            if not s:
                continue
            if not all(c.isalnum() or c in "-_" for c in s):
                raise ValueError(f"invalid slug character in {s!r}")
            cleaned.append(s)
        return cleaned


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
