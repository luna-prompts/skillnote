import uuid as uuid_lib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from app.core.errors import api_error
from sqlalchemy.orm import Session

from app.db.models import Skill, SkillVersion, SkillContentVersion
from app.db.session import get_db
from app.schemas.skill import SkillListItem, SkillDetail, SkillCreate, SkillUpdate
from app.schemas.version import SkillVersionItem, ContentVersionItem

router = APIRouter(prefix="/v1/skills", tags=["skills"])


def _get_skill(slug: str, db: Session) -> Skill:
    skill_row = db.query(Skill).filter(Skill.slug == slug).first()
    if not skill_row:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")
    return skill_row


def _create_content_version(db: Session, skill: Skill) -> SkillContentVersion:
    """Snapshot current skill state as a new content version."""
    next_ver = (skill.current_version or 0) + 1

    # Clear is_latest on all existing versions for this skill
    db.query(SkillContentVersion).filter(
        SkillContentVersion.skill_id == skill.id,
        SkillContentVersion.is_latest == True,
    ).update({"is_latest": False})

    cv = SkillContentVersion(
        id=uuid_lib.uuid4(),
        skill_id=skill.id,
        version=next_ver,
        title=skill.name,
        description=skill.description,
        content_md=skill.content_md or "",
        tags=skill.tags or [],
        collections=skill.collections or [],
        is_latest=True,
    )
    db.add(cv)

    skill.current_version = next_ver
    return cv


@router.get("", response_model=list[SkillListItem])
def list_skills(db: Session = Depends(get_db)):
    rows = db.query(Skill).order_by(Skill.slug.asc()).all()

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
                currentVersion=skill.current_version or 0,
            )
        )

    return out


@router.get("/{skill}/versions", response_model=list[SkillVersionItem])
def list_versions(
    skill: str,
    db: Session = Depends(get_db),
):
    skill_row = (
        db.query(Skill)
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


@router.get("/{skill_slug}/content-versions", response_model=list[ContentVersionItem])
def list_content_versions(
    skill_slug: str,
    db: Session = Depends(get_db),
):
    skill_row = _get_skill(skill_slug, db)
    versions = (
        db.query(SkillContentVersion)
        .filter(SkillContentVersion.skill_id == skill_row.id)
        .order_by(SkillContentVersion.version.desc())
        .all()
    )
    return versions


@router.post("/{skill_slug}/content-versions/{version}/set-latest", response_model=SkillDetail)
def set_latest_version(
    skill_slug: str,
    version: int,
    db: Session = Depends(get_db),
):
    skill_row = _get_skill(skill_slug, db)

    target = (
        db.query(SkillContentVersion)
        .filter(SkillContentVersion.skill_id == skill_row.id, SkillContentVersion.version == version)
        .first()
    )
    if not target:
        raise api_error(404, "VERSION_NOT_FOUND", f"Version {version} not found")

    # Clear all is_latest flags
    db.query(SkillContentVersion).filter(
        SkillContentVersion.skill_id == skill_row.id,
        SkillContentVersion.is_latest == True,
    ).update({"is_latest": False})

    target.is_latest = True

    # Apply version content to the skill
    skill_row.name = target.title
    skill_row.description = target.description
    skill_row.content_md = target.content_md
    skill_row.tags = target.tags or []
    skill_row.collections = target.collections or []
    skill_row.current_version = target.version
    skill_row.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(skill_row)
    return skill_row



@router.get("/{skill_slug}", response_model=SkillDetail)
def get_skill(
    skill_slug: str,
    db: Session = Depends(get_db),
):
    skill_row = _get_skill(skill_slug, db)
    return skill_row


@router.post("", response_model=SkillDetail, status_code=201)
def create_skill(
    payload: SkillCreate,
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
        current_version=0,
    )
    db.add(skill)
    db.flush()

    # Create initial version (v1)
    _create_content_version(db, skill)

    db.commit()
    db.refresh(skill)
    return skill


@router.patch("/{skill_slug}", response_model=SkillDetail)
def update_skill(
    skill_slug: str,
    payload: SkillUpdate,
    db: Session = Depends(get_db),
):
    skill_row = _get_skill(skill_slug, db)

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

    # Auto-create a new content version on every save
    _create_content_version(db, skill_row)

    db.commit()
    db.refresh(skill_row)
    return skill_row


@router.delete("/{skill_slug}", status_code=204)
def delete_skill(
    skill_slug: str,
    db: Session = Depends(get_db),
):
    skill_row = _get_skill(skill_slug, db)
    db.delete(skill_row)
    db.commit()
