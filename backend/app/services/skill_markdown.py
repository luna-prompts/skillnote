"""Canonical SKILL.md rendering.

Every surface that materializes a skill as a file — the current-content
download endpoint, bundle builders, agent sync scripts — must produce the
same frontmatter with the same safety guarantees. This module is the single
source of truth for that shape.

The guarantee: whatever a skill's fields contain, the rendered document has
exactly one frontmatter block, the reserved keys (`name`, `description`,
`collections`) hold the registry's values, and nothing in the body can be
promoted into frontmatter.
"""
from __future__ import annotations

import json
from typing import Any, Iterable, Optional

import yaml

# Keys the registry owns. A skill's free-form `extra_frontmatter` may not
# override them — otherwise an imported skill could rename itself to shadow
# another skill, or rewrite the description an agent uses for triggering.
RESERVED_KEYS = ("name", "description", "collections")


def sanitize_extra_frontmatter(raw: Optional[str]) -> list[str]:
    """Return safe `key: value` lines from a user/import-supplied YAML blob.

    `extra_frontmatter` is free-form text owned by whoever authored or
    imported the skill. Appending it verbatim lets it smuggle a `---` fence
    (closing the frontmatter early and injecting attacker-controlled text
    into the body an agent reads) or redeclare a reserved key (last-key-wins
    in most YAML parsers). So: parse it, keep only a top-level mapping, drop
    reserved keys, and re-emit every entry through the JSON encoder — JSON
    is valid YAML, so scalars come back quoted and fence-free.

    Anything that isn't a parseable top-level mapping is dropped entirely
    rather than passed through; a skill with malformed extras renders
    without them instead of rendering something unsafe.
    """
    if not raw or not raw.strip():
        return []
    try:
        parsed: Any = yaml.safe_load(raw)
    except yaml.YAMLError:
        return []
    if not isinstance(parsed, dict):
        return []

    lines: list[str] = []
    for key, value in parsed.items():
        if not isinstance(key, str):
            continue
        key = key.strip()
        # Keys must be plain identifiers; anything else can't be rendered
        # unquoted without risking a structural break.
        if not key or key.lower() in RESERVED_KEYS:
            continue
        if not all(ch.isalnum() or ch in "-_." for ch in key):
            continue
        lines.append(f"{key}: {_encode(value)}")
    return lines


def _encode(value: Any) -> str:
    """Render a value as JSON, which is a valid YAML subset."""
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return json.dumps(str(value), ensure_ascii=False)


def build_skill_md(
    *,
    name: str,
    description: str = "",
    collections: Optional[Iterable[str]] = None,
    extra_frontmatter: Optional[str] = None,
    content_md: str = "",
) -> str:
    """Render a complete SKILL.md document.

    Reserved scalars are JSON-encoded so colons, quotes, newlines and
    non-ASCII text can't break the block. The body is emitted verbatim: a
    body that itself starts with `---` is harmless because it lands after
    the blank line that terminates the frontmatter.
    """
    cols = [c for c in (collections or []) if isinstance(c, str)]
    frontmatter = [
        f"name: {json.dumps(name, ensure_ascii=False)}",
        f"description: {json.dumps(description or '', ensure_ascii=False)}",
    ]
    if cols:
        frontmatter.append(f"collections: {json.dumps(cols, ensure_ascii=False)}")
    frontmatter.extend(sanitize_extra_frontmatter(extra_frontmatter))

    return "---\n" + "\n".join(frontmatter) + "\n---\n\n" + (content_md or "")
