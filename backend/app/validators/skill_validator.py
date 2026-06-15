import re

NAME_MAX = 64
DESC_MAX = 1024
MAX_SKILLS_PER_COLLECTION = 15
NAME_PATTERN = re.compile(r"^[a-z0-9_-]+(?::[a-z0-9_-]+)?$")
XML_TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")
RESERVED_WORDS = ["anthropic", "claude"]
# Windows reserves these device names — a directory/file with one of these
# names (any case, with or without extension) can't be created. Skills sync to
# per-agent folders named after the slug (CLI: ~/.claude/skills/<slug>/...), so
# a skill named exactly "con"/"nul"/"com1" would be uninstallable on Windows.
# Reject them at the source (EXACT match — unlike RESERVED_WORDS' substring
# check, so legitimate names like "icons" or "control" are unaffected).
WINDOWS_RESERVED_NAMES = frozenset(
    ["con", "prn", "aux", "nul"]
    + [f"com{i}" for i in range(1, 10)]
    + [f"lpt{i}" for i in range(1, 10)]
)


def validate_skill_name(name: str) -> list[str]:
    errors: list[str] = []
    name = name.strip()
    if not name:
        errors.append("Name is required")
        return errors
    if len(name) > NAME_MAX:
        errors.append(f"Name must be {NAME_MAX} characters or fewer")
    if not NAME_PATTERN.match(name):
        errors.append("Name must use only lowercase letters, numbers, hyphens, and underscores, with an optional namespace prefix (e.g. ns:name)")
    for word in RESERVED_WORDS:
        if word in name:
            errors.append(f'Name cannot contain reserved word "{word}"')
    if name.lower() in WINDOWS_RESERVED_NAMES:
        errors.append(f'"{name}" is a reserved name on Windows — choose another')
    if XML_TAG_RE.search(name):
        errors.append("Name cannot contain XML tags")
    return errors


def validate_skill_description(description: str) -> list[str]:
    errors: list[str] = []
    description = description.strip()
    if not description:
        errors.append("Description is required")
        return errors
    if len(description) > DESC_MAX:
        errors.append(f"Description must be {DESC_MAX} characters or fewer")
    if XML_TAG_RE.search(description):
        errors.append("Description cannot contain XML tags")
    return errors


def validate_collections(collections: list[str]) -> list[str]:
    errors: list[str] = []
    if not collections:
        errors.append("At least one collection is required")
    return errors


def validate_collection_skill_count(db, collection_name: str, exclude_skill_id=None) -> str | None:
    """Check if a collection already has MAX_SKILLS_PER_COLLECTION skills.

    Uses case-insensitive comparison so "Frontend" and "frontend" count together.
    Returns an error message string if the limit is reached, or None if OK.
    """
    from sqlalchemy import text

    sql = text(
        """
        SELECT COUNT(*) FROM skills
        WHERE EXISTS (
            SELECT 1 FROM unnest(collections) AS c
            WHERE lower(c) = lower(:name)
        )
        """ + (" AND id != :skill_id" if exclude_skill_id is not None else "")
    )
    params = {"name": collection_name}
    if exclude_skill_id is not None:
        params["skill_id"] = exclude_skill_id
    count = db.execute(sql, params).scalar() or 0
    if count >= MAX_SKILLS_PER_COLLECTION:
        return f'Collection "{collection_name}" has reached the {MAX_SKILLS_PER_COLLECTION}-skill limit. Remove a skill before adding a new one.'
    return None


def canonicalize_collection_names(db, collections: list[str]) -> list[str]:
    """Map each incoming collection name to its canonical (stored) form.

    If a collection exists (case-insensitively) in the collections table or in
    any existing skill.collections array, return the existing variant.
    Otherwise, return the name stripped. De-duplicates case-variants too:
    ["Frontend", "frontend"] → ["Frontend"] (or whichever matches stored form).
    """
    from sqlalchemy import text

    if not collections:
        return []

    # Trim + case-normalize each input, de-duplicating on lowercase form
    seen_lower: dict[str, str] = {}
    for name in collections:
        stripped = (name or "").strip()
        if not stripped:
            continue
        key = stripped.lower()
        if key not in seen_lower:
            seen_lower[key] = stripped

    if not seen_lower:
        return []

    # Look up canonical forms from collections table (authoritative source)
    rows = db.execute(
        text("SELECT name FROM collections WHERE lower(name) = ANY(:keys)"),
        {"keys": list(seen_lower.keys())},
    ).all()
    canonical = {row[0].lower(): row[0] for row in rows}

    # For collections NOT in the table, check if any existing skill uses that name
    missing = [k for k in seen_lower if k not in canonical]
    if missing:
        rows = db.execute(
            text(
                "SELECT DISTINCT c FROM skills, unnest(collections) AS c "
                "WHERE lower(c) = ANY(:keys)"
            ),
            {"keys": missing},
        ).all()
        for row in rows:
            lk = row[0].lower()
            if lk not in canonical:
                canonical[lk] = row[0]

    return [canonical.get(k, seen_lower[k]) for k in seen_lower]
