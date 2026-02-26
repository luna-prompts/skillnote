from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.api.deps import get_current_token
from app.db.models import AccessToken, Skill, TokenSkillGrant
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
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skills = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == current_token.id)
        .all()
    )
    tag_counts: dict[str, int] = {}
    for skill in skills:
        for tag in (skill.tags or []):
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
    return [TagOut(name=name, skill_count=count) for name, count in sorted(tag_counts.items())]


@router.patch("/{tag_name}", response_model=dict)
def rename_tag(
    tag_name: str,
    payload: TagRenameRequest,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skills = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == current_token.id)
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
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skills = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == current_token.id)
        .filter(Skill.tags.contains([tag_name]))
        .all()
    )
    for skill in skills:
        skill.tags = [t for t in (skill.tags or []) if t != tag_name]
        skill.updated_at = datetime.now(timezone.utc)
    db.commit()
