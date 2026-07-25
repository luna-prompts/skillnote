import hashlib
import io
import zipfile

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.models import Skill, SkillVersion
from app.db.session import get_db
from app.services.skill_markdown import build_skill_md
from app.services.storage_service import storage

router = APIRouter(prefix="/v1/skills", tags=["downloads"])


# Declared before the versioned route so "current" is never captured as a
# {version} path parameter.
@router.get("/{skill}/current/download")
def download_current_skill_bundle(
    skill: str,
    db: Session = Depends(get_db),
):
    """Build a bundle from the current UI content, even when it was never published."""
    skill_row = (
        db.query(Skill)
        .filter((Skill.slug == skill) | (Skill.name == skill))
        .first()
    )
    if not skill_row:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")

    # Disabling every published version is the only lever an operator has to
    # pull a skill out of distribution, and the versioned route enforces it
    # with 403 VERSION_DISABLED. Honour the same kill switch here: a skill
    # that has versions but none active is withdrawn, not draft. Skills that
    # were never published have no versions at all and stay downloadable —
    # that is the whole point of this route.
    version_count = (
        db.query(SkillVersion).filter(SkillVersion.skill_id == skill_row.id).count()
    )
    if version_count:
        has_active = (
            db.query(SkillVersion)
            .filter(SkillVersion.skill_id == skill_row.id, SkillVersion.status == "active")
            .first()
        )
        if not has_active:
            raise api_error(
                403,
                "SKILL_WITHDRAWN",
                "Every published version of this skill is disabled",
            )

    content = build_skill_md(
        name=skill_row.slug,
        description=skill_row.description or "",
        collections=skill_row.collections or [],
        extra_frontmatter=skill_row.extra_frontmatter,
        content_md=skill_row.content_md or "",
    ).encode("utf-8")
    bundle = io.BytesIO()
    # ZIP_STORED, not DEFLATE: the checksum clients diff against is taken
    # over these bytes, and deflate output is only stable for a given zlib
    # build. Storing uncompressed keeps identical content byte-identical
    # across server upgrades, so `skillnote update` can't churn spuriously.
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_STORED) as archive:
        info = zipfile.ZipInfo("SKILL.md", date_time=(1980, 1, 1, 0, 0, 0))
        info.external_attr = 0o644 << 16
        archive.writestr(info, content, compress_type=zipfile.ZIP_STORED)
    payload = bundle.getvalue()
    checksum = hashlib.sha256(payload).hexdigest()
    current_version = str(skill_row.current_version or 0)
    return Response(
        content=payload,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{skill_row.slug}-current.zip"',
            "X-Skill-Name": skill_row.slug,
            "X-Skill-Version": f"current-{current_version}",
            "X-Checksum-Sha256": checksum,
        },
    )


@router.get("/{skill}/{version}/download")
def download_skill_bundle(
    skill: str,
    version: str,
    db: Session = Depends(get_db),
):
    skill_row = (
        db.query(Skill)
        .filter((Skill.slug == skill) | (Skill.name == skill))
        .first()
    )
    if not skill_row:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")

    version_row = (
        db.query(SkillVersion)
        .filter(SkillVersion.skill_id == skill_row.id, SkillVersion.version == version)
        .first()
    )
    if not version_row:
        raise api_error(404, "VERSION_NOT_FOUND", "Version not found")
    if version_row.status == "disabled":
        raise api_error(403, "VERSION_DISABLED", "Version is disabled")

    try:
        file_path = storage.resolve(version_row.bundle_storage_key)
    except ValueError:
        raise api_error(500, "STORAGE_KEY_INVALID", "Invalid storage key")

    if not file_path.exists():
        raise api_error(404, "BUNDLE_NOT_FOUND", "Bundle file not found")

    actual_checksum = hashlib.sha256(file_path.read_bytes()).hexdigest()
    if actual_checksum != version_row.checksum_sha256:
        raise api_error(409, "CHECKSUM_MISMATCH", "Stored checksum does not match bundle")

    headers = {
        "X-Skill-Name": skill_row.slug,
        "X-Skill-Version": version_row.version,
        "X-Checksum-Sha256": version_row.checksum_sha256,
    }
    return FileResponse(
        path=str(file_path),
        media_type="application/zip",
        filename=f"{skill_row.slug}-{version_row.version}.zip",
        headers=headers,
    )
