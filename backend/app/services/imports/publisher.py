"""Publisher: serialize a SkillNote collection to a Claude-Code-compatible marketplace.json.

Only imported skills are emitted; user-authored skills are omitted. The v1 scope (per spec):
publish-back requires a git-clonable source, which only imported skills have.
"""
from __future__ import annotations

import hashlib
import json

from sqlalchemy.orm import Session

from app.db.models import Collection, ImportSource, Skill


def serialize_collection(db: Session, collection_name: str) -> dict:
    """Build a Claude-Code-compatible marketplace.json for the given collection."""
    c = db.get(Collection, collection_name)
    if c is None:
        raise ValueError(f"Collection '{collection_name}' not found")

    # Find all skills in this collection that have an import source.
    # `Skill.collections` is an ARRAY(Text) column; `.any(value)` compiles to
    # `value = ANY(skills.collections)` which matches membership.
    skills = (
        db.query(Skill)
        .filter(Skill.collections.any(collection_name))
        .filter(Skill.import_source_id.is_not(None))
        .all()
    )
    source_ids = {s.import_source_id for s in skills}
    sources_by_id: dict = {}
    if source_ids:
        sources = (
            db.query(ImportSource)
            .filter(ImportSource.id.in_(source_ids))
            .all()
        )
        sources_by_id = {s.id: s for s in sources}

    plugins = []
    for skill in skills:
        src = sources_by_id.get(skill.import_source_id)
        if src is None:
            continue
        plugin_entry = {
            "name": skill.slug,
            "description": (skill.description or "")[:1024],
            "source": _build_source_entry(src, skill),
        }
        plugins.append(plugin_entry)

    return {
        "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
        "name": collection_name,
        "owner": {
            "name": f"SkillNote — {collection_name}",
            "email": "noreply@skillnote.local",
        },
        "metadata": {
            "description": c.description or f"Collection {collection_name}",
            "version": "1.0.0",
        },
        "plugins": plugins,
    }


def _build_source_entry(src: ImportSource, skill: Skill) -> dict:
    """Convert an ImportSource + skill to a plugin source entry.

    Emits git-subdir when a subpath is known; falls back to github otherwise.
    Omits ``ref`` when unknown rather than fabricating ``"main"``, since a
    synthetic ref may not contain the recorded SHA; consumers can still
    ``git fetch <sha>`` without a ref.
    """
    sha = skill.source_sha or src.imported_at_sha
    if src.source_type == "github" and skill.source_path:
        entry = {
            "source": "git-subdir",
            "url": f"https://github.com/{src.owner}/{src.repo}",
            "path": skill.source_path,
        }
        if src.ref:
            entry["ref"] = src.ref
        if sha:
            entry["sha"] = sha
        return entry
    if src.source_type == "github":
        entry = {
            "source": "github",
            "repo": f"{src.owner}/{src.repo}",
        }
        if src.ref:
            entry["ref"] = src.ref
        if sha:
            entry["sha"] = sha
        return entry
    # Fallback: url source
    entry = {"source": "url", "url": src.url}
    if src.ref:
        entry["ref"] = src.ref
    if sha:
        entry["sha"] = sha
    return entry


def compute_etag(manifest: dict) -> str:
    """Stable ETag based on serialized content."""
    payload = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    return f'"{hashlib.sha256(payload).hexdigest()[:16]}"'
