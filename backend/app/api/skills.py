import uuid as uuid_lib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from app.core.errors import api_error
from sqlalchemy.orm import Session

from app.api.deps import get_current_token
from app.db.models import Skill, SkillVersion, TokenSkillGrant, AccessToken
from app.db.session import get_db
from app.schemas.skill import SkillListItem, SkillDetail, SkillCreate, SkillUpdate
from app.schemas.version import SkillVersionItem

router = APIRouter(prefix="/v1/skills", tags=["skills"])


@router.get("", response_model=list[SkillListItem])
def list_skills(
    current_token: AccessToken = Depends(get_current_token), db: Session = Depends(get_db)
):
    rows = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == current_token.id)
        .order_by(Skill.slug.asc())
        .all()
    )

    out: list[SkillListItem] = []
    for skill in rows:
        latest = (
            db.query(SkillVersion)
            .filter(SkillVersion.skill_id == skill.id)
            .order_by(SkillVersion.published_at.desc())
            .first()
        )
        out.append(
            SkillListItem(
                name=skill.name,
                slug=skill.slug,
                description=skill.description,
                tags=skill.tags or [],
                collections=skill.collections or [],
                latestVersion=latest.version if latest else None,
                status=latest.status if latest else None,
                channel=latest.channel if latest else None,
            )
        )

    return out


@router.get("/{skill}/versions", response_model=list[SkillVersionItem])
def list_versions(
    skill: str,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill_row = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == current_token.id)
        .filter((Skill.slug == skill) | (Skill.name == skill))
        .first()
    )
    if not skill_row:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")

    versions = (
        db.query(SkillVersion)
        .filter(SkillVersion.skill_id == skill_row.id)
        .order_by(SkillVersion.published_at.desc())
        .all()
    )

    return [
        SkillVersionItem(
            version=v.version,
            checksumSha256=v.checksum_sha256,
            status=v.status,
            channel=v.channel,
            publishedAt=v.published_at,
            releaseNotes=v.release_notes,
        )
        for v in versions
    ]


@router.get("/{skill_slug}", response_model=SkillDetail)
def get_skill(
    skill_slug: str,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill_row = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == current_token.id)
        .filter(Skill.slug == skill_slug)
        .first()
    )
    if not skill_row:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")
    return skill_row


@router.post("", response_model=SkillDetail, status_code=201)
def create_skill(
    payload: SkillCreate,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    existing = db.query(Skill).filter(Skill.slug == payload.slug).first()
    if existing:
        raise api_error(409, "SKILL_SLUG_EXISTS", f"Slug '{payload.slug}' already exists")

    skill = Skill(
        id=uuid_lib.uuid4(),
        name=payload.name,
        slug=payload.slug,
        description=payload.description,
        content_md=payload.content_md,
        tags=payload.tags,
        collections=payload.collections,
    )
    db.add(skill)
    db.flush()

    grant = TokenSkillGrant(
        id=uuid_lib.uuid4(),
        token_id=current_token.id,
        skill_id=skill.id,
    )
    db.add(grant)
    db.commit()
    db.refresh(skill)
    return skill


@router.patch("/{skill_slug}", response_model=SkillDetail)
def update_skill(
    skill_slug: str,
    payload: SkillUpdate,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill_row = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == current_token.id)
        .filter(Skill.slug == skill_slug)
        .first()
    )
    if not skill_row:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")

    if payload.name is not None:
        skill_row.name = payload.name
    if payload.description is not None:
        skill_row.description = payload.description
    if payload.content_md is not None:
        skill_row.content_md = payload.content_md
    if payload.tags is not None:
        skill_row.tags = payload.tags
    if payload.collections is not None:
        skill_row.collections = payload.collections
    skill_row.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(skill_row)
    return skill_row


@router.delete("/{skill_slug}", status_code=204)
def delete_skill(
    skill_slug: str,
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    skill_row = (
        db.query(Skill)
        .join(TokenSkillGrant, TokenSkillGrant.skill_id == Skill.id)
        .filter(TokenSkillGrant.token_id == current_token.id)
        .filter(Skill.slug == skill_slug)
        .first()
    )
    if not skill_row:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")

    db.delete(skill_row)
    db.commit()
