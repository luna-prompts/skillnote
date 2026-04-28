from datetime import datetime
from typing import Literal
import uuid

from pydantic import BaseModel, Field, field_validator, model_validator

# All valid agent-side comment_type values.  Kept here as the canonical list so
# both the schema and any future code-gen/docs stay in sync.
AgentCommentType = Literal[
    "agent_observation",
    "agent_issue",
    "agent_patch_suggestion",
    "agent_success_note",
    "agent_deprecation_warning",
]


class CommentOut(BaseModel):
    id: uuid.UUID
    author: str
    body: str
    created_at: datetime
    updated_at: datetime
    author_type: str
    comment_type: str | None
    rating: int | None
    linked_usage_id: uuid.UUID | None

    model_config = {"from_attributes": True}


class CommentCreate(BaseModel):
    author: str
    body: str
    author_type: Literal["human", "agent"] = "human"
    # When author_type == "agent" this must be one of the five AgentCommentType
    # values.  When author_type == "human" it must be None (or omitted).
    # The model_validator below enforces the cross-field rule; the Literal here
    # gives Pydantic a closed set to validate against for agent comments.
    comment_type: AgentCommentType | None = Field(default=None)
    rating: int | None = Field(default=None, ge=1, le=5)
    linked_usage_id: uuid.UUID | None = None

    @field_validator("body")
    @classmethod
    def _strip_body(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("body must not be empty or whitespace-only")
        return s

    @model_validator(mode="after")
    def _agent_requires_comment_type(self):
        if self.author_type == "agent" and not self.comment_type:
            raise ValueError("agent comments require comment_type")
        # Prevent humans from spoofing agent-reserved comment_type namespaces.
        if self.author_type == "human" and self.comment_type and self.comment_type.startswith("agent_"):
            raise ValueError("human comments cannot use agent-reserved comment_type values (prefix 'agent_')")
        return self


class CommentUpdate(BaseModel):
    body: str

    @field_validator("body")
    @classmethod
    def _strip_body(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("body must not be empty or whitespace-only")
        return s
