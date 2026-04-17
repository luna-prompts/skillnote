from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

from app.validators.collection_validator import validate_collection_name


class CollectionListItem(BaseModel):
    name: str
    count: int
    description: str = ""


class CollectionCreate(BaseModel):
    name: str
    description: str = ""

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str) -> str:
        errors = validate_collection_name(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v.strip()

    @field_validator("description")
    @classmethod
    def check_description(cls, v: Optional[str]) -> str:
        if v is None:
            return ""
        if len(v) > 1024:
            raise ValueError("Description must be 1024 characters or fewer")
        return v.strip()


class CollectionUpdate(BaseModel):
    description: str = ""

    @field_validator("description")
    @classmethod
    def check_description(cls, v: Optional[str]) -> str:
        if v is None:
            return ""
        if len(v) > 1024:
            raise ValueError("Description must be 1024 characters or fewer")
        return v.strip()


class CollectionDetail(BaseModel):
    model_config = {"from_attributes": True}

    name: str
    description: str
    created_at: datetime
    updated_at: datetime
