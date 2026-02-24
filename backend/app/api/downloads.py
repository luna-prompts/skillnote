import hashlib

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_token
from app.core.errors import api_error
from app.db.models import AccessToken, Skill, SkillVersion, TokenSkillGrant
from app.db.session import get_db
from app.services.storage_service import storage

router = APIRouter(prefix="/v1/skills", tags=["downloads"])


@router.get("/{skill}/{version}/download")
def download_skill_bundle(
    skill: str,
    version: str,
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
