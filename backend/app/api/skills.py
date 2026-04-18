import re
import uuid as uuid_lib
from datetime import datetime, timezone

from typing import Optional

from fastapi import APIRouter, Depends, Query
from app.core.errors import api_error
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.models import Skill, SkillVersion, SkillContentVersion
from app.db.session import get_db
from app.schemas.skill import SkillListItem, SkillDetail, SkillCreate, SkillUpdate
from app.schemas.version import SkillVersionItem, ContentVersionItem
from app.validators.skill_validator import (
    canonicalize_collection_names,
    validate_collection_skill_count,
)
from app.validators.collection_validator import validate_collection_name

router = APIRouter(prefix="/v1/skills", tags=["skills"])


def _slugify(name: str) -> str:
    """Convert a skill name to a URL-safe slug (consistent with bundle_validator)."""
    s = name.lower()
    s = re.sub(r'[^a-z0-9\s_-]', '', s)  # keep underscores
    s = re.sub(r'[\s_]+', '-', s)          # underscores → hyphens
    s = re.sub(r'-+', '-', s)
    s = s.strip('-')
    return s


def _skill_total_versions(db: Session, skill_id) -> int:
    from app.db.models.skill_content_version import SkillContentVersion as _SCV
    return db.query(_SCV).filter(_SCV.skill_id == skill_id).count()


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
        collections=skill.collections or [],
        is_latest=True,
    )
    db.add(cv)

    skill.current_version = next_ver
    return cv


@router.get("", response_model=list[SkillListItem])
def list_skills(
    collections: Optional[str] = Query(None, description="Comma-separated collection names to filter by"),
    db: Session = Depends(get_db),
):
    query = db.query(Skill)
    if collections:
        col_list = [c.strip() for c in collections.split(",") if c.strip()]
        if col_list:
            # Case-insensitive match: any collection in the skill's array
            # lowercases to one of the requested names.
            lower_list = [c.lower() for c in col_list]
            query = query.filter(
                text(
                    "EXISTS (SELECT 1 FROM unnest(skills.collections) AS c "
                    "WHERE lower(c) = ANY(:lower_list))"
                ).bindparams(lower_list=lower_list)
            )
    rows = query.order_by(Skill.slug.asc()).all()

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
                collections=skill.collections or [],
                content_md=skill.content_md or "",
                latestVersion=latest.version if latest else None,
                status=latest.status if latest else None,
                channel=latest.channel if latest else None,
                currentVersion=skill.current_version or 0,
                extra_frontmatter=skill.extra_frontmatter,
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
    skill_row.collections = target.collections or []
    skill_row.current_version = target.version
    skill_row.updated_at = datetime.now(timezone.utc)

    # Update slug if name changed
    new_slug = _slugify(target.title)
    if new_slug and new_slug != skill_row.slug:
        existing = db.query(Skill).filter(Skill.slug == new_slug, Skill.id != skill_row.id).first()
        if existing:
            raise api_error(409, "SKILL_SLUG_EXISTS", f"Slug '{new_slug}' already exists")
        skill_row.slug = new_slug

    db.commit()
    db.refresh(skill_row)
    return SkillDetail(
        id=skill_row.id,
        name=skill_row.name,
        slug=skill_row.slug,
        description=skill_row.description,
        content_md=skill_row.content_md,
        collections=skill_row.collections or [],
        current_version=skill_row.current_version or 0,
        total_versions=_skill_total_versions(db, skill_row.id),
        extra_frontmatter=skill_row.extra_frontmatter,
        created_at=skill_row.created_at,
        updated_at=skill_row.updated_at,
    )


@router.post("/{skill_slug}/content-versions/{version}/restore", response_model=SkillDetail)
def restore_version(
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

    # Apply version content to skill
    skill_row.name = target.title
    skill_row.description = target.description
    skill_row.content_md = target.content_md
    skill_row.collections = target.collections or []
    skill_row.updated_at = datetime.now(timezone.utc)

    # Update slug if name changed
    new_slug = _slugify(target.title)
    if new_slug and new_slug != skill_row.slug:
        existing = db.query(Skill).filter(Skill.slug == new_slug, Skill.id != skill_row.id).first()
        if existing:
            raise api_error(409, "SKILL_SLUG_EXISTS", f"Slug '{new_slug}' already exists")
        skill_row.slug = new_slug

    # Create a new version snapshot for the restore
    _create_content_version(db, skill_row)

    db.commit()
    db.refresh(skill_row)
    return SkillDetail(
        id=skill_row.id,
        name=skill_row.name,
        slug=skill_row.slug,
        description=skill_row.description,
        content_md=skill_row.content_md,
        collections=skill_row.collections or [],
        current_version=skill_row.current_version or 0,
        total_versions=_skill_total_versions(db, skill_row.id),
        extra_frontmatter=skill_row.extra_frontmatter,
        created_at=skill_row.created_at,
        updated_at=skill_row.updated_at,
    )


@router.get("/{skill_slug}", response_model=SkillDetail)
def get_skill(
    skill_slug: str,
    db: Session = Depends(get_db),
):
    skill_row = _get_skill(skill_slug, db)
    return SkillDetail(
        id=skill_row.id,
        name=skill_row.name,
        slug=skill_row.slug,
        description=skill_row.description,
        content_md=skill_row.content_md,
        collections=skill_row.collections or [],
        current_version=skill_row.current_version or 0,
        total_versions=_skill_total_versions(db, skill_row.id),
        extra_frontmatter=skill_row.extra_frontmatter,
        created_at=skill_row.created_at,
        updated_at=skill_row.updated_at,
    )


@router.post("", response_model=SkillDetail, status_code=201)
def create_skill(
    payload: SkillCreate,
    db: Session = Depends(get_db),
):
    existing = db.query(Skill).filter(Skill.slug == payload.slug).first()
    if existing:
        raise api_error(409, "SKILL_SLUG_EXISTS", f"Slug '{payload.slug}' already exists")

    # Canonicalize: map case variants to existing stored forms, de-duplicate
    canonical_collections = canonicalize_collection_names(db, payload.collections or [])

    # Validate each canonical name against the shared collection-name rule
    for col_name in canonical_collections:
        name_errs = validate_collection_name(col_name)
        if name_errs:
            raise api_error(422, "COLLECTION_NAME_INVALID",
                            f'Collection "{col_name}": {"; ".join(name_errs)}')

    # Auto-promote: ensure every referenced collection has a row in the
    # `collections` table so detail/PUT/DELETE endpoints can reach it.
    # (Without this, a skill can implicitly create a name that is listed via
    #  GET /v1/collections but 404s on GET /v1/collections/{name}.)
    if canonical_collections:
        db.execute(
            text(
                "INSERT INTO collections (name, description, created_at, updated_at) "
                "SELECT n.name, '', now(), now() "
                "FROM unnest(CAST(:names AS text[])) AS n(name) "
                "WHERE NOT EXISTS ("
                "    SELECT 1 FROM collections c WHERE lower(c.name) = lower(n.name)"
                ")"
            ),
            {"names": canonical_collections},
        )

    # Check collection skill-count limits
    for col_name in canonical_collections:
        err = validate_collection_skill_count(db, col_name)
        if err:
            raise api_error(422, "COLLECTION_LIMIT_REACHED", err)

    skill = Skill(
        id=uuid_lib.uuid4(),
        name=payload.name,
        slug=payload.slug,
        description=payload.description,
        content_md=payload.content_md,
        collections=canonical_collections,
        extra_frontmatter=payload.extra_frontmatter,
        current_version=0,
    )
    db.add(skill)
    db.flush()

    # Create initial version (v1)
    _create_content_version(db, skill)

    # Notify MCP server of tool-list change (delivered on commit)
    db.execute(text("SELECT pg_notify('skillnote_skills_changed', 'created')"))
    db.commit()
    db.refresh(skill)
    return SkillDetail(
        id=skill.id,
        name=skill.name,
        slug=skill.slug,
        description=skill.description,
        content_md=skill.content_md,
        collections=skill.collections or [],
        current_version=skill.current_version or 0,
        total_versions=_skill_total_versions(db, skill.id),
        extra_frontmatter=skill.extra_frontmatter,
        created_at=skill.created_at,
        updated_at=skill.updated_at,
    )


@router.patch("/{skill_slug}", response_model=SkillDetail)
def update_skill(
    skill_slug: str,
    payload: SkillUpdate,
    db: Session = Depends(get_db),
):
    skill_row = _get_skill(skill_slug, db)

    if payload.name is not None:
        skill_row.name = payload.name
        # Auto-update slug when name changes
        new_slug = _slugify(payload.name)
        if new_slug and new_slug != skill_row.slug:
            existing = db.query(Skill).filter(Skill.slug == new_slug, Skill.id != skill_row.id).first()
            if existing:
                raise api_error(409, "SKILL_SLUG_EXISTS", f"Slug '{new_slug}' already exists")
            skill_row.slug = new_slug
    if payload.description is not None:
        skill_row.description = payload.description
    if payload.content_md is not None:
        skill_row.content_md = payload.content_md
    if payload.collections is not None:
        # Canonicalize incoming names to stored case + de-duplicate variants
        canonical_collections = canonicalize_collection_names(db, payload.collections)
        # Validate each canonical name against the shared rule
        for col_name in canonical_collections:
            name_errs = validate_collection_name(col_name)
            if name_errs:
                raise api_error(422, "COLLECTION_NAME_INVALID",
                                f'Collection "{col_name}": {"; ".join(name_errs)}')
        # Auto-promote: ensure every referenced collection has a row in the
        # `collections` table so detail/PUT/DELETE endpoints can reach it.
        # (Without this, a skill can implicitly create a name that is listed via
        #  GET /v1/collections but 404s on GET /v1/collections/{name}.)
        if canonical_collections:
            db.execute(
                text(
                    "INSERT INTO collections (name, description, created_at, updated_at) "
                    "SELECT n.name, '', now(), now() "
                    "FROM unnest(CAST(:names AS text[])) AS n(name) "
                    "WHERE NOT EXISTS ("
                    "    SELECT 1 FROM collections c WHERE lower(c.name) = lower(n.name)"
                    ")"
                ),
                {"names": canonical_collections},
            )
        # Check skill-count limits for any newly added collections (case-insensitive)
        current_lower = {c.lower() for c in (skill_row.collections or [])}
        for col_name in canonical_collections:
            if col_name.lower() not in current_lower:
                err = validate_collection_skill_count(db, col_name, exclude_skill_id=skill_row.id)
                if err:
                    raise api_error(422, "COLLECTION_LIMIT_REACHED", err)
        skill_row.collections = canonical_collections
    if payload.extra_frontmatter is not None:
        skill_row.extra_frontmatter = payload.extra_frontmatter
    skill_row.updated_at = datetime.now(timezone.utc)

    # Auto-create a new content version on every save
    _create_content_version(db, skill_row)

    # Notify MCP server of tool-list change (delivered on commit)
    db.execute(text("SELECT pg_notify('skillnote_skills_changed', 'updated')"))
    db.commit()
    db.refresh(skill_row)
    return SkillDetail(
        id=skill_row.id,
        name=skill_row.name,
        slug=skill_row.slug,
        description=skill_row.description,
        content_md=skill_row.content_md,
        collections=skill_row.collections or [],
        current_version=skill_row.current_version or 0,
        total_versions=_skill_total_versions(db, skill_row.id),
        extra_frontmatter=skill_row.extra_frontmatter,
        created_at=skill_row.created_at,
        updated_at=skill_row.updated_at,
    )


@router.delete("/{skill_slug}", status_code=204)
def delete_skill(
    skill_slug: str,
    db: Session = Depends(get_db),
):
    skill_row = _get_skill(skill_slug, db)
    db.delete(skill_row)
    # Notify MCP server of tool-list change (delivered on commit)
    db.execute(text("SELECT pg_notify('skillnote_skills_changed', 'deleted')"))
    db.commit()
