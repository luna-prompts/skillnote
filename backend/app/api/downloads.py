import hashlib
import io
import json
import zipfile

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.models import Skill, SkillVersion
from app.db.session import get_db
from app.services.storage_service import storage

router = APIRouter(prefix="/v1/skills", tags=["downloads"])


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

    # JSON string/list syntax is valid YAML and safely handles colons, quotes,
    # newlines, and non-ASCII text without adding a PyYAML formatting dependency
    # to the download path.
    frontmatter = [
        f"name: {json.dumps(skill_row.slug, ensure_ascii=False)}",
        f"description: {json.dumps(skill_row.description or '', ensure_ascii=False)}",
    ]
    if skill_row.collections:
        frontmatter.append(
            f"collections: {json.dumps(skill_row.collections, ensure_ascii=False)}"
        )
    if skill_row.extra_frontmatter and skill_row.extra_frontmatter.strip():
        frontmatter.append(skill_row.extra_frontmatter.strip())

    content = (
        "---\n"
        + "\n".join(frontmatter)
        + "\n---\n\n"
        + (skill_row.content_md or "")
    ).encode("utf-8")
    bundle = io.BytesIO()
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("SKILL.md", content)
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
