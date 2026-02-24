from datetime import datetime, timezone
import hashlib
from pathlib import Path
import shutil
import tempfile

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_token
from app.core.config import settings
from app.core.errors import api_error
from app.db.models import AccessToken, Skill, SkillVersion, TokenSkillGrant
from app.db.session import get_db
from app.validators.bundle_validator import validate_zip_and_extract_metadata

router = APIRouter(prefix="/v1", tags=["publish"])


@router.post("/publish")
def publish_skill(
    version: str = Form(...),
    release_notes: str | None = Form(default=None),
    status: str = Form(default="active"),
    channel: str = Form(default="stable"),
    grant_all_tokens: bool = Form(default=True),
    bundle: UploadFile = File(...),
    current_token: AccessToken = Depends(get_current_token),
    db: Session = Depends(get_db),
):
    if current_token.subject_type != "admin":
        raise api_error(403, "FORBIDDEN", "Admin token required for publish")

    if not bundle.filename or not bundle.filename.endswith(".zip"):
        raise api_error(400, "BUNDLE_INVALID", "Only .zip bundle is supported")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_zip = Path(tmpdir) / "upload.zip"
        with tmp_zip.open("wb") as f:
            shutil.copyfileobj(bundle.file, f)

        try:
            name, slug, description = validate_zip_and_extract_metadata(str(tmp_zip))
        except ValueError as e:
            raise api_error(400, "BUNDLE_INVALID", str(e))

        storage_key = f"skills/{slug}/{version}.zip"
        dst = Path(settings.bundle_storage_dir) / storage_key
        dst.parent.mkdir(parents=True, exist_ok=True)

        if dst.exists():
            raise api_error(409, "VERSION_EXISTS", "Version bundle already exists")

        shutil.copy2(tmp_zip, dst)
        checksum = hashlib.sha256(dst.read_bytes()).hexdigest()

    skill = db.query(Skill).filter(Skill.slug == slug).first()
    if not skill:
        skill = Skill(name=name, slug=slug, description=description)
        db.add(skill)
        db.flush()

    existing = (
        db.query(SkillVersion)
        .filter(SkillVersion.skill_id == skill.id, SkillVersion.version == version)
        .first()
    )
    if existing:
        raise api_error(409, "VERSION_EXISTS", "Version already exists")

    row = SkillVersion(
        skill_id=skill.id,
        version=version,
        checksum_sha256=checksum,
        bundle_storage_key=storage_key,
        release_notes=release_notes,
        status=status,
        channel=channel,
        published_at=datetime.now(timezone.utc),
    )
    db.add(row)

    if grant_all_tokens:
        tokens = db.query(AccessToken).filter(AccessToken.status == "active").all()
        for t in tokens:
            exists = (
                db.query(TokenSkillGrant)
                .filter(TokenSkillGrant.token_id == t.id, TokenSkillGrant.skill_id == skill.id)
                .first()
            )
            if not exists:
                db.add(TokenSkillGrant(token_id=t.id, skill_id=skill.id))

    db.commit()

    return {
        "skill": skill.slug,
        "version": version,
        "checksumSha256": checksum,
        "storageKey": storage_key,
    }
