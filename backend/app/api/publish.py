from datetime import datetime, timezone
import hashlib
from pathlib import Path
import re
import shutil
import tempfile

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import api_error
from app.db.models import Skill, SkillVersion
from app.db.session import get_db
from app.validators.bundle_validator import validate_zip_and_extract_metadata

router = APIRouter(prefix="/v1", tags=["publish"])

ALLOWED_STATUS = {"active", "deprecated", "disabled"}
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")


@router.post("/publish")
def publish_skill(
    version: str = Form(...),
    release_notes: str | None = Form(default=None),
    status: str = Form(default="active"),
    channel: str = Form(default="stable"),
    bundle: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not bundle.filename or not bundle.filename.endswith(".zip"):
        raise api_error(400, "BUNDLE_INVALID", "Only .zip bundle is supported")
    if status not in ALLOWED_STATUS:
        raise api_error(400, "STATUS_INVALID", "Invalid status")
    if not SEMVER_RE.match(version):
        raise api_error(400, "VERSION_INVALID", "Version must be semver (e.g. 1.2.3)")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_zip = Path(tmpdir) / "upload.zip"
        with tmp_zip.open("wb") as f:
            shutil.copyfileobj(bundle.file, f)

        upload_size = tmp_zip.stat().st_size
        if upload_size > settings.max_bundle_size_bytes:
            raise api_error(413, "BUNDLE_TOO_LARGE", "Bundle exceeds size limit")

        try:
            name, slug, description = validate_zip_and_extract_metadata(str(tmp_zip))
        except ValueError as e:
            raise api_error(400, "BUNDLE_INVALID", str(e))

        storage_key = f"skills/{slug}/{version}.zip"
        dst = Path(settings.bundle_storage_dir) / storage_key

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
        if existing or dst.exists():
            raise api_error(409, "VERSION_EXISTS", "Version already exists")

        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(tmp_zip, dst)
        checksum = hashlib.sha256(dst.read_bytes()).hexdigest()

    try:
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
        db.commit()
    except Exception:
        db.rollback()
        # avoid orphan bundle on DB failure
        bundle_path = Path(settings.bundle_storage_dir) / storage_key
        if bundle_path.exists():
            bundle_path.unlink()
        raise

    return {
        "skill": skill.slug,
        "version": version,
        "checksumSha256": checksum,
        "storageKey": storage_key,
    }
