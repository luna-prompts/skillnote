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

    plugins = []
    for skill in skills:
        src = db.get(ImportSource, skill.import_source_id)
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
    """
    if src.source_type == "github" and skill.source_path:
        return {
            "source": "git-subdir",
            "url": f"https://github.com/{src.owner}/{src.repo}",
            "path": skill.source_path,
            "ref": src.ref or "main",
            "sha": skill.source_sha or src.imported_at_sha,
        }
    if src.source_type == "github":
        return {
            "source": "github",
            "repo": f"{src.owner}/{src.repo}",
            "ref": src.ref or "main",
            "sha": skill.source_sha or src.imported_at_sha,
        }
    # Fallback: url source
    return {
        "source": "url",
        "url": src.url,
        "ref": src.ref,
        "sha": skill.source_sha or src.imported_at_sha,
    }


def compute_etag(manifest: dict) -> str:
    """Stable ETag based on serialized content."""
    payload = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    return f'"{hashlib.sha256(payload).hexdigest()[:16]}"'
