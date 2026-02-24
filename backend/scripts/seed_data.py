import hashlib
from datetime import datetime, timezone
from pathlib import Path
import sys

from sqlalchemy import text

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings
from app.db.models import AccessToken, Skill, SkillVersion, TokenSkillGrant
from app.db.session import SessionLocal


PLAINTEXT_TOKEN = "skn_dev_demo_token"


def hash_token(token: str) -> str:
    raw = f"{settings.token_pepper}:{token}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def main():
    db = SessionLocal()
    try:
        # quick connection check
        db.execute(text("SELECT 1"))

        skill = db.query(Skill).filter(Skill.slug == "secure-migrations").first()
        if not skill:
            skill = Skill(
                name="secure-migrations",
                slug="secure-migrations",
                description="DB migration safety checklist",
            )
            db.add(skill)
            db.flush()

        version = (
            db.query(SkillVersion)
            .filter(SkillVersion.skill_id == skill.id, SkillVersion.version == "0.1.0")
            .first()
        )
        if not version:
            version = SkillVersion(
                skill_id=skill.id,
                version="0.1.0",
                checksum_sha256="0" * 64,
                bundle_storage_key="skills/secure-migrations/0.1.0.zip",
                release_notes="Initial seed version",
                status="active",
                channel="stable",
                published_at=datetime.now(timezone.utc),
            )
            db.add(version)

        token_hash = hash_token(PLAINTEXT_TOKEN)
        token = db.query(AccessToken).filter(AccessToken.token_hash == token_hash).first()
        if not token:
            token = AccessToken(
                token_hash=token_hash,
                label="dev-seed-token",
                status="active",
                subject_type="user",
                subject_id="seed-user",
            )
            db.add(token)
            db.flush()

        grant = (
            db.query(TokenSkillGrant)
            .filter(TokenSkillGrant.token_id == token.id, TokenSkillGrant.skill_id == skill.id)
            .first()
        )
        if not grant:
            db.add(TokenSkillGrant(token_id=token.id, skill_id=skill.id))

        db.commit()
        print("Seed complete")
        print(f"Plain token (dev only): {PLAINTEXT_TOKEN}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
