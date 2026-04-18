"""Transactional import applier.

UPSERT semantics:
- import_sources: UPSERT on (url, ref, subpath) - refreshes last_synced_at, sha, status.
- collections: INSERT ... ON CONFLICT DO NOTHING (via get-or-create).
- skills: 3 paths based on existing-skill state (see spec).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from app.db.models import Skill, Collection, ImportSource
from app.services.imports.inspector import InspectResult
from app.services.imports.manifest_schema import SkillFrontmatter


class ImportError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def apply_import(
    db: Session,
    inspect_result: InspectResult,
    target_collection_slug: str,
    skill_selection: Optional[List[str]] = None,
    on_conflict: str = "rename",
) -> dict:
    """Apply a previously-inspected source into the DB. Returns {source_id, collection_slug, imported, skipped}."""
    now = datetime.now(timezone.utc)
    # 1) Validate target collection slug (reuses 0.3.2 validator)
    from app.validators.collection_validator import validate_collection_name
    errs = validate_collection_name(target_collection_slug)
    if errs:
        raise ImportError("COLLECTION_NAME_INVALID", "; ".join(errs))

    # 2) Ensure collection exists FIRST - import_sources.collection_name FK requires it.
    #    (get-or-create; ON CONFLICT DO NOTHING semantics)
    col = db.get(Collection, target_collection_slug)
    if col is None:
        col = Collection(
            name=target_collection_slug,
            description=f"Imported from {inspect_result.host}/{inspect_result.owner}/{inspect_result.repo}",
        )
        db.add(col)
        db.flush()

    # 3) Canonical URL: single source of truth that inspector + importer agree on.
    canonical_url = inspect_result.url  # always set by inspector, e.g. "github.com/owner/repo"

    # Postgres ON CONFLICT UPSERT - race-safe, idempotent by (url, ref, subpath).
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    stmt = pg_insert(ImportSource).values(
        id=uuid.uuid4(),
        source_type=inspect_result.source_type,
        url=canonical_url,
        host=inspect_result.host,
        owner=inspect_result.owner,
        repo=inspect_result.repo,
        ref=inspect_result.ref,
        subpath=inspect_result.subpath,
        kind=inspect_result.kind or "plugin",
        collection_name=target_collection_slug,
        imported_at_sha=inspect_result.resolved_sha,
        upstream_sha=inspect_result.resolved_sha,
        last_synced_at=now,
        status="up_to_date",
        last_error=None,
    ).on_conflict_do_update(
        index_elements=["url", "ref", "subpath"],
        set_={
            "imported_at_sha": inspect_result.resolved_sha,
            "upstream_sha": inspect_result.resolved_sha,
            "last_synced_at": now,
            "status": "up_to_date",
            "last_error": None,
        },
    ).returning(ImportSource.id)
    src_id = db.execute(stmt).scalar_one()
    src = db.get(ImportSource, src_id)

    # 4) For each selected skill, resolve conflict + insert/update
    imported = []
    skipped = []
    for skill_meta in (inspect_result.skills or []):
        name = skill_meta.get("name")
        if skill_selection is not None and name not in skill_selection:
            continue

        # Defense-in-depth per-skill validation. SkillFrontmatter runs at clone
        # time (Task 21) but we re-run here to guard against in-flight tampering
        # of InspectResult.skills (e.g., test stubs, future inspector paths).
        try:
            SkillFrontmatter.model_validate({
                "name": name,
                "description": skill_meta.get("description") or "",
            })
        except Exception as e:
            skipped.append({
                "name": name,
                "reason": "validation_failed",
                "message": str(e)[:200],
            })
            continue

        # Path safety: reject absolute paths and any `..` segments.
        # Full symlink-safety is enforced by bundle_validator at upload time;
        # string-based checks are sufficient for inspector-provided paths.
        path = skill_meta.get("path") or ""
        if (
            ".." in path.split("/")
            or path.startswith("/")
            or path.startswith("\\")
        ):
            skipped.append({
                "name": name,
                "reason": "validation_failed",
                "message": "Unsafe path: contains .. or is absolute",
            })
            continue

        existing = db.query(Skill).filter(Skill.slug == name).first()
        if existing is None:
            content_hash = skill_meta.get("content_hash") or ""
            new_skill = Skill(
                id=uuid.uuid4(),
                name=name, slug=name,
                description=skill_meta.get("description", ""),
                collections=[target_collection_slug],
                import_source_id=src.id,
                source_path=skill_meta.get("path"),
                source_sha=inspect_result.resolved_sha,
                source_content_hash=content_hash,
                forked_from_source=False,
            )
            db.add(new_skill)
            imported.append({"name": name, "slug": name})
        else:
            # Conflict path: if existing skill belongs to this source and is unchanged, no-op
            if existing.import_source_id == src.id and not existing.forked_from_source:
                if existing.source_content_hash != skill_meta.get("content_hash"):
                    existing.description = skill_meta.get("description", existing.description)
                    existing.source_content_hash = skill_meta.get("content_hash")
                    existing.source_sha = inspect_result.resolved_sha
                imported.append({"name": name, "slug": name})
            elif on_conflict == "skip":
                skipped.append({"name": name, "reason": "conflict"})
            elif on_conflict == "rename":
                new_name = _find_available_slug(db, name)
                new_skill = Skill(
                    id=uuid.uuid4(),
                    name=new_name, slug=new_name,
                    description=skill_meta.get("description", ""),
                    collections=[target_collection_slug],
                    import_source_id=src.id,
                    source_path=skill_meta.get("path"),
                    source_sha=inspect_result.resolved_sha,
                    source_content_hash=skill_meta.get("content_hash", ""),
                    forked_from_source=False,
                )
                db.add(new_skill)
                imported.append({"name": new_name, "slug": new_name,
                                 "original_name": name, "renamed_reason": "conflict"})
            elif on_conflict == "replace":
                raise ImportError(
                    "NOT_IMPLEMENTED_YET",
                    "on_conflict='replace' is scheduled for v1.1; use 'rename' or 'skip' in v1",
                )

    # If every candidate skill was rejected BY VALIDATION, abort so the user
    # sees a clear error instead of a silent zero-imported success. We only
    # consider validation_failed — conflict-skip with on_conflict=skip is a
    # valid zero-import outcome (user's explicit choice) that shouldn't 422.
    validation_failures = [
        s for s in skipped if s.get("reason") == "validation_failed"
    ]
    if (
        not imported
        and validation_failures
        and len(validation_failures) == len(skipped)
        and inspect_result.skills
    ):
        raise ImportError(
            "ALL_SKILLS_INVALID",
            f"All {len(validation_failures)} skills failed validation: "
            + "; ".join(
                f"{s['name']}: {s.get('message', s['reason'])}"
                for s in validation_failures[:3]
            ),
        )

    db.commit()
    return {
        "source_id": str(src.id),
        "collection_slug": target_collection_slug,
        "imported": imported,
        "skipped": skipped,
    }


# NOTE: This is a read-then-insert race. Two concurrent imports could both pick
# the same candidate. 15-skill collection cap + low import volume makes this
# negligible in practice; full fix is retry-on-unique-violation (deferred).
def _find_available_slug(db: Session, base: str) -> str:
    i = 2
    while True:
        candidate = f"{base}-{i}"
        if db.query(Skill).filter(Skill.slug == candidate).first() is None:
            return candidate
        i += 1
