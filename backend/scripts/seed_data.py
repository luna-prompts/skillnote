import hashlib
from datetime import datetime, timezone
from pathlib import Path
import sys
import zipfile

from sqlalchemy import text

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings
from app.db.models import Skill, SkillVersion
from app.db.session import SessionLocal


def ensure_seed_bundle() -> tuple[str, str]:
    storage_key = "skills/secure-migrations/0.1.0.zip"
    bundle_path = Path(settings.bundle_storage_dir) / storage_key
    bundle_path.parent.mkdir(parents=True, exist_ok=True)

    skill_md = """---
name: secure-migrations
description: DB migration safety checklist
---

# Secure Migrations

A checklist for safely deploying database migrations in production.

## Before You Migrate

- Review backwards compatibility — ensure old app version works with new schema
- Test the migration on staging first
- Have a rollback plan (down migration or snapshot)
- Communicate planned downtime if schema locks are expected

## Running the Migration

```bash
# Always dry-run first
alembic upgrade head --sql | less

# Apply
alembic upgrade head
```

## After Migration

- Verify row counts on critical tables
- Run smoke tests against the updated schema
- Monitor error rates for 15 minutes post-deploy
"""

    with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("SKILL.md", skill_md)

    checksum = hashlib.sha256(bundle_path.read_bytes()).hexdigest()
    return storage_key, checksum


def main():
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        storage_key, checksum = ensure_seed_bundle()

        skill = db.query(Skill).filter(Skill.slug == "secure-migrations").first()
        content = """# Secure Migrations\n\nA checklist for safely deploying database migrations in production.\n\n## Before You Migrate\n\n- Review backwards compatibility — ensure old app version works with new schema\n- Test the migration on staging first\n- Have a rollback plan (down migration or snapshot)\n- Communicate planned downtime if schema locks are expected\n\n## Running the Migration\n\n```bash\n# Always dry-run first\nalembic upgrade head --sql | less\n\n# Apply\nalembic upgrade head\n```\n\n## After Migration\n\n- Verify row counts on critical tables\n- Run smoke tests against the updated schema\n- Monitor error rates for 15 minutes post-deploy\n"""
        if not skill:
            skill = Skill(
                name="secure-migrations",
                slug="secure-migrations",
                description="DB migration safety checklist",
                content_md=content,
                tags=["database", "devops"],
                collections=["DevOps"],
            )
            db.add(skill)
            db.flush()
        else:
            if not skill.tags:
                skill.tags = ["database", "devops"]
            if not skill.collections:
                skill.collections = ["DevOps"]
            if not skill.content_md:
                skill.content_md = content

        version = (
            db.query(SkillVersion)
            .filter(SkillVersion.skill_id == skill.id, SkillVersion.version == "0.1.0")
            .first()
        )
        if not version:
            version = SkillVersion(
                skill_id=skill.id,
                version="0.1.0",
                checksum_sha256=checksum,
                bundle_storage_key=storage_key,
                release_notes="Initial seed version",
                status="active",
                channel="stable",
                published_at=datetime.now(timezone.utc),
            )
            db.add(version)
        else:
            version.checksum_sha256 = checksum
            version.bundle_storage_key = storage_key

        db.commit()
        print("Seed complete")
        print(f"Bundle: {storage_key}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
