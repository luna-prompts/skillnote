import hashlib
import uuid as uuid_lib
from datetime import datetime, timezone
from pathlib import Path
import sys
import zipfile

from sqlalchemy import text

ROOT_DIR = Path(__file__).resolve().parents[1]
SEEDS_DIR = Path(__file__).resolve().parent / "seeds"

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings
from app.db.models import Skill, SkillVersion, SkillContentVersion
from app.db.session import SessionLocal


def parse_frontmatter(md: str) -> tuple[dict, str]:
    """Extract YAML frontmatter and body from a markdown string."""
    if not md.startswith("---"):
        return {}, md
    end = md.find("---", 3)
    if end == -1:
        return {}, md
    fm_text = md[3:end].strip()
    body = md[end + 3:].strip()
    data = {}
    for line in fm_text.splitlines():
        if ":" in line:
            key, val = line.split(":", 1)
            data[key.strip()] = val.strip()
    return data, body


def ensure_bundle(slug: str, skill_md: str) -> tuple[str, str]:
    storage_key = f"skills/{slug}/0.1.0.zip"
    bundle_path = Path(settings.bundle_storage_dir) / storage_key
    bundle_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("SKILL.md", skill_md)

    checksum = hashlib.sha256(bundle_path.read_bytes()).hexdigest()
    return storage_key, checksum


def seed_skill(db, slug: str, name: str, description: str, content_md: str, tags: list, collections: list):
    """Seed a single skill with v1 content version if it doesn't exist."""
    skill = db.query(Skill).filter(Skill.slug == slug).first()
    if skill:
        print(f"  Skill '{slug}' already exists, skipping")
        return

    skill = Skill(
        id=uuid_lib.uuid4(),
        name=name,
        slug=slug,
        description=description,
        content_md=content_md,
        tags=tags,
        collections=collections,
        current_version=1,
    )
    db.add(skill)
    db.flush()

    # Create v1 content version
    cv = SkillContentVersion(
        id=uuid_lib.uuid4(),
        skill_id=skill.id,
        version=1,
        title=name,
        description=description,
        content_md=content_md,
        tags=tags,
        collections=collections,
        is_latest=True,
    )
    db.add(cv)

    # Create bundle version
    full_md = f"---\nname: {name}\ndescription: {description}\n---\n\n{content_md}"
    storage_key, checksum = ensure_bundle(slug, full_md)
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
    print(f"  Seeded '{slug}' with v1")


def main():
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        print("Seeding skills...")

        # 1. Skill Creator (from Anthropic's official skills repo)
        skill_creator_path = SEEDS_DIR / "skill-creator.md"
        if skill_creator_path.exists():
            raw = skill_creator_path.read_text()
            fm, body = parse_frontmatter(raw)
            seed_skill(
                db,
                slug="skill-creator",
                name="skill-creator",
                description=fm.get("description", "Create new skills, modify and improve existing skills, and measure skill performance."),
                content_md=body,
                tags=["meta", "skills", "anthropic"],
                collections=["Official"],
            )

        # 2. Secure Migrations (existing seed)
        seed_skill(
            db,
            slug="secure-migrations",
            name="secure-migrations",
            description="DB migration safety checklist",
            content_md="# Secure Migrations\n\nA checklist for safely deploying database migrations in production.\n\n## Before You Migrate\n\n- Review backwards compatibility\n- Test the migration on staging first\n- Have a rollback plan (down migration or snapshot)\n- Communicate planned downtime if schema locks are expected\n\n## Running the Migration\n\n```bash\n# Always dry-run first\nalembic upgrade head --sql | less\n\n# Apply\nalembic upgrade head\n```\n\n## After Migration\n\n- Verify row counts on critical tables\n- Run smoke tests against the updated schema\n- Monitor error rates for 15 minutes post-deploy",
            tags=["database", "devops"],
            collections=["DevOps"],
        )

        db.commit()
        print("Seed complete")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
