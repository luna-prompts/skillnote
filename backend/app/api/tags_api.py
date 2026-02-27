from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.models import Skill
from app.db.session import get_db
from datetime import datetime, timezone


class TagOut(BaseModel):
    name: str
    skill_count: int


class TagRenameRequest(BaseModel):
    new_name: str


router = APIRouter(prefix="/v1/tags", tags=["tags"])


@router.get("", response_model=list[TagOut])
def list_tags(
    db: Session = Depends(get_db),
):
    skills = db.query(Skill).all()
    tag_counts: dict[str, int] = {}
    for skill in skills:
        for tag in (skill.tags or []):
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
    return [TagOut(name=name, skill_count=count) for name, count in sorted(tag_counts.items())]


@router.patch("/{tag_name}", response_model=dict)
def rename_tag(
    tag_name: str,
    payload: TagRenameRequest,
    db: Session = Depends(get_db),
):
    skills = (
        db.query(Skill)
        .filter(Skill.tags.contains([tag_name]))
        .all()
    )
    for skill in skills:
        skill.tags = [payload.new_name if t == tag_name else t for t in (skill.tags or [])]
        skill.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"renamed": len(skills), "from": tag_name, "to": payload.new_name}


@router.delete("/{tag_name}", status_code=204)
def delete_tag(
    tag_name: str,
    db: Session = Depends(get_db),
):
    skills = (
        db.query(Skill)
        .filter(Skill.tags.contains([tag_name]))
        .all()
    )
    for skill in skills:
        skill.tags = [t for t in (skill.tags or []) if t != tag_name]
        skill.updated_at = datetime.now(timezone.utc)
    db.commit()
