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


def seed_skill(db, slug: str, name: str, description: str, content_md: str, collections: list):
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
                collections=["Official"],
            )

        # 2. Skill Push (from seeds/ file)
        skill_push_path = SEEDS_DIR / "skill-push.md"
        if skill_push_path.exists():
            raw = skill_push_path.read_text()
            fm, body = parse_frontmatter(raw)
            seed_skill(
                db,
                slug="skill-push",
                name="skill-push",
                description=fm.get("description", "Create and push skills to the SkillNote registry."),
                content_md=body,
                collections=["Official"],
            )

        # 3. Secure Migrations (existing seed)
        seed_skill(
            db,
            slug="secure-migrations",
            name="secure-migrations",
            description="DB migration safety checklist",
            content_md="# Secure Migrations\n\nA checklist for safely deploying database migrations in production.\n\n## Before You Migrate\n\n- Review backwards compatibility\n- Test the migration on staging first\n- Have a rollback plan (down migration or snapshot)\n- Communicate planned downtime if schema locks are expected\n\n## Running the Migration\n\n```bash\n# Always dry-run first\nalembic upgrade head --sql | less\n\n# Apply\nalembic upgrade head\n```\n\n## After Migration\n\n- Verify row counts on critical tables\n- Run smoke tests against the updated schema\n- Monitor error rates for 15 minutes post-deploy",
            collections=["DevOps"],
        )

        # 4. Code Review Checklist
        seed_skill(
            db,
            slug="code-review-checklist",
            name="code-review-checklist",
            description="Structured code review checklist. Trigger when: review, PR, pull request, code review, feedback.",
            content_md="# Code Review Checklist\n\nWhen reviewing a pull request, check:\n\n## Correctness\n- Does the code do what it claims?\n- Are edge cases handled?\n- Are there off-by-one errors?\n\n## Security\n- No hardcoded secrets or API keys\n- Input validation on user data\n- SQL injection / XSS prevention\n\n## Performance\n- No N+1 queries\n- No unnecessary re-renders\n- Pagination for large lists\n\n## Readability\n- Clear variable/function names\n- No overly clever one-liners\n- Comments explain WHY, not WHAT\n\n## Tests\n- New code has tests\n- Edge cases covered\n- Tests actually assert something meaningful",
            collections=["Conventions"],
        )

        # 5. Git Commit Convention
        seed_skill(
            db,
            slug="git-commit-convention",
            name="git-commit-convention",
            description="Conventional commit message format. Trigger when: commit, git commit, commit message, conventional commits.",
            content_md="# Git Commit Convention\n\nUse Conventional Commits format:\n\n```\n<type>(<scope>): <description>\n\n[optional body]\n[optional footer]\n```\n\n## Types\n- `feat`: New feature\n- `fix`: Bug fix\n- `docs`: Documentation only\n- `style`: Formatting, no code change\n- `refactor`: Code restructuring\n- `test`: Adding tests\n- `chore`: Maintenance\n\n## Rules\n- Subject line max 72 chars\n- Use imperative mood (\"add\" not \"added\")\n- No period at the end\n- Body explains WHY, not WHAT\n- Reference issues: `Fixes #123`",
            collections=["Conventions"],
        )

        # 6. Error Handling Pattern
        seed_skill(
            db,
            slug="error-handling",
            name="error-handling",
            description="Standard error handling patterns. Trigger when: error, exception, try catch, error handling, error boundary.",
            content_md="# Error Handling\n\n## Backend (Python)\n- Use specific exception types, not bare `except:`\n- Log errors with context (user ID, request ID)\n- Return structured errors: `{\"error\": {\"code\": \"...\", \"message\": \"...\"}}`\n- Never expose stack traces to clients\n\n## Frontend (React)\n- Use Error Boundaries for component trees\n- Handle loading/error/success states explicitly\n- Show user-friendly messages, log technical details\n- Use `toast.error()` for transient errors\n\n## API Calls\n- Always handle network errors\n- Implement retry with exponential backoff for transient failures\n- Set timeouts on all HTTP requests\n- Validate response shape before using",
            collections=["Conventions"],
        )

        # 7. Testing Guide
        seed_skill(
            db,
            slug="testing-guide",
            name="testing-guide",
            description="Testing best practices and patterns. Trigger when: test, testing, unit test, integration test, write tests.",
            content_md="# Testing Guide\n\n## Unit Tests\n- Test one thing per test\n- Name tests: `test_<what>_<condition>_<expected>`\n- Use arrange-act-assert pattern\n- Mock external dependencies, not internal logic\n\n## Integration Tests\n- Test the API contract, not implementation\n- Use a real database (not mocks) for DB tests\n- Clean up test data after each test\n\n## What to Test\n- Happy path\n- Edge cases (empty, null, max length)\n- Error paths (invalid input, network failure)\n- Authorization (can't access other user's data)\n\n## What NOT to Test\n- Framework internals\n- Third-party library behavior\n- Exact UI pixel layout",
            collections=["Conventions"],
        )

        # 8. Docker Deploy
        seed_skill(
            db,
            slug="docker-deploy",
            name="docker-deploy",
            description="Docker deployment checklist. Trigger when: deploy, docker, container, production, ship.",
            content_md="# Docker Deploy\n\n## Pre-Deploy\n- [ ] All tests pass locally\n- [ ] Environment variables set in production\n- [ ] Database migrations tested on staging\n- [ ] Health check endpoint responds\n\n## Deploy\n```bash\ndocker compose pull\ndocker compose up -d\n```\n\n## Post-Deploy\n- [ ] Health check passes: `curl /health`\n- [ ] Smoke test critical flows\n- [ ] Monitor error rates for 15 minutes\n- [ ] Check logs: `docker compose logs -f`\n\n## Rollback\n```bash\ndocker compose down\ngit checkout <previous-tag>\ndocker compose up -d\n```",
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
