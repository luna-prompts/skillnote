from datetime import datetime
from pydantic import BaseModel
import uuid


class CommentOut(BaseModel):
    id: uuid.UUID
    author: str
    body: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CommentCreate(BaseModel):
    author: str
    body: str


class CommentUpdate(BaseModel):
    body: str
