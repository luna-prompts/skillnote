from fastapi import APIRouter, Depends
from app.core.errors import api_error
from sqlalchemy.orm import Session

from app.api.deps import get_current_token
from app.db.models import Skill, SkillVersion, TokenSkillGrant, AccessToken
from app.db.session import get_db
from app.schemas.skill import SkillListItem
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
