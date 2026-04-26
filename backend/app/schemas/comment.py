from datetime import datetime
from typing import Literal
import uuid

from pydantic import BaseModel, Field, model_validator


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
    comment_type: str | None = Field(default=None, max_length=64)
    rating: int | None = Field(default=None, ge=1, le=5)
    linked_usage_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _agent_requires_comment_type(self):
        if self.author_type == "agent" and not self.comment_type:
            raise ValueError("agent comments require comment_type")
        return self


class CommentUpdate(BaseModel):
    body: str
