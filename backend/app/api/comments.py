import uuid as uuid_lib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.models import Skill, SkillUsageEvent
from app.db.models.comment import Comment
from app.db.session import get_db
from app.schemas.comment import CommentCreate, CommentOut, CommentUpdate

router = APIRouter(prefix="/v1/skills/{skill_slug}/comments", tags=["comments"])


def _get_skill(skill_slug: str, db: Session) -> Skill:
    skill = db.query(Skill).filter(Skill.slug == skill_slug).first()
    if not skill:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")
    return skill


@router.get("", response_model=list[CommentOut])
def list_comments(
    skill_slug: str,
    db: Session = Depends(get_db),
):
    skill = _get_skill(skill_slug, db)
    return db.query(Comment).filter(Comment.skill_id == skill.id).order_by(Comment.created_at.asc()).all()


@router.post("", response_model=CommentOut, status_code=201)
def create_comment(
    skill_slug: str,
    payload: CommentCreate,
    db: Session = Depends(get_db),
):
    skill = _get_skill(skill_slug, db)

    # Defense-in-depth: schema's _agent_requires_comment_type validator already
    # enforces this at parse time, but we re-check at the handler boundary so
    # the contract is guarded even if the schema is later relaxed.
    if payload.author_type == "agent" and not payload.comment_type:
        raise api_error(
            422,
            "AGENT_COMMENT_REQUIRES_TYPE",
            "agent comments require comment_type",
        )

    if payload.linked_usage_id is not None:
        exists = (
            db.query(SkillUsageEvent.id)
            .filter(SkillUsageEvent.id == payload.linked_usage_id)
            .first()
        )
        if not exists:
            raise api_error(
                404,
                "LINKED_USAGE_NOT_FOUND",
                f"Usage event {payload.linked_usage_id} not found",
            )

    comment = Comment(
        id=uuid_lib.uuid4(),
        skill_id=skill.id,
        author=payload.author,
        body=payload.body,
        author_type=payload.author_type,
        comment_type=payload.comment_type,
        rating=payload.rating,
        linked_usage_id=payload.linked_usage_id,
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
    db: Session = Depends(get_db),
):
    skill = _get_skill(skill_slug, db)
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
    db: Session = Depends(get_db),
):
    skill = _get_skill(skill_slug, db)
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.skill_id == skill.id).first()
    if not comment:
        raise api_error(404, "COMMENT_NOT_FOUND", "Comment not found")
    db.delete(comment)
    db.commit()
