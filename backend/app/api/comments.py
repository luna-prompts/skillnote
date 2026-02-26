import uuid as uuid_lib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_token
from app.core.errors import api_error
from app.db.models import AccessToken, Skill, TokenSkillGrant
from app.db.models.comment import Comment
from app.db.session import get_db
from app.schemas.comment import CommentCreate, CommentOut, CommentUpdate

router = APIRouter(prefix="/v1/skills/{skill_slug}/comments", tags=["comments"])


def _get_authorized_skill(skill_slug: str, token: AccessToken, db: Session) -> Skill:
    skill = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == token.id)
        .filter(Skill.slug == skill_slug)
        .first()
    )
    if not skill:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")
    return skill


@router.get("", response_model=list[CommentOut])
def list_comments(
    skill_slug: str,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill = _get_authorized_skill(skill_slug, current_token, db)
    return db.query(Comment).filter(Comment.skill_id == skill.id).order_by(Comment.created_at.asc()).all()


@router.post("", response_model=CommentOut, status_code=201)
def create_comment(
    skill_slug: str,
    payload: CommentCreate,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill = _get_authorized_skill(skill_slug, current_token, db)
    comment = Comment(
        id=uuid_lib.uuid4(),
        skill_id=skill.id,
        author=payload.author,
        body=payload.body,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@router.patch("/{comment_id}", response_model=CommentOut)
def update_comment(
    skill_slug: str,
    comment_id: uuid_lib.UUID,
    payload: CommentUpdate,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill = _get_authorized_skill(skill_slug, current_token, db)
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.skill_id == skill.id).first()
    if not comment:
        raise api_error(404, "COMMENT_NOT_FOUND", "Comment not found")
    comment.body = payload.body
    comment.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(comment)
    return comment


@router.delete("/{comment_id}", status_code=204)
def delete_comment(
    skill_slug: str,
    comment_id: uuid_lib.UUID,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill = _get_authorized_skill(skill_slug, current_token, db)
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.skill_id == skill.id).first()
    if not comment:
        raise api_error(404, "COMMENT_NOT_FOUND", "Comment not found")
    db.delete(comment)
    db.commit()
