"""slugify collection names

Revision ID: 0012_slugify_collection_names
Revises: 0011_collections_table
Create Date: 2026-04-18

Key invariant: all valid names are reserved in ``used`` BEFORE any collision
resolution begins, so a collision-resolved ``-N`` suffix can never clobber a
pre-existing valid slug. Additionally, every candidate (base and any
``-N``-suffixed variant) is clamped via ``_clamp_with_suffix`` so the final
rewritten name always fits in ``MAX_LEN`` — preserving the bound checked by
the post-migration smoke test (``test_collection_names_are_bounded``) and any
future validator call.
"""
import hashlib
import re

from alembic import op
import sqlalchemy as sa

revision = '0012_slugify_collection_names'
down_revision = '0011_collections_table'
branch_labels = None
depends_on = None


NAME_PATTERN = re.compile(r"^[a-z0-9_-]+$")
MAX_LEN = 128


def _slugify(name: str) -> str:
    s = name.lower()
    s = re.sub(r"[^a-z0-9_-]+", "-", s)
    s = re.sub(r"-+", "-", s)
    s = s.strip("-")
    return s[:MAX_LEN]


def _fallback(original: str) -> str:
    return f"collection-{hashlib.sha1(original.encode('utf-8')).hexdigest()[:8]}"


def _clamp_with_suffix(base: str, suffix: str) -> str:
    """Truncate base so that base + suffix fits in MAX_LEN. Strip trailing '-'
    after truncation so we don't leave '---2'."""
    max_base = MAX_LEN - len(suffix)
    truncated = base[:max_base].rstrip("-")
    return truncated + suffix


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Gather every distinct collection name (union of collections table + skills embedded arrays)
    rows = conn.execute(sa.text(
        """
        SELECT name, created_at FROM (
            SELECT name, created_at FROM collections
            UNION
            SELECT DISTINCT unnest(collections) AS name, now() AS created_at
            FROM skills
            WHERE collections IS NOT NULL AND collections != '{}'
        ) u
        ORDER BY created_at, name
        """
    )).all()

    # 2. Build the rename map with collision resolution.
    # First pass: reserve EVERY already-valid name so later collision resolution
    # cannot clobber a pre-existing valid slug.
    used: set[str] = {
        name for name, _created in rows
        if NAME_PATTERN.match(name) and len(name) <= MAX_LEN
    }

    # Second pass: slugify + collision-resolve the invalid names only.
    rename: dict[str, str] = {}
    for name, _created in rows:
        if name in used:
            continue  # already a valid slug — no rename needed
        candidate = _slugify(name) or _fallback(name)
        # Clamp candidate to MAX_LEN before collision check (see I1)
        candidate = _clamp_with_suffix(candidate, "")
        if candidate in used:
            base = candidate
            i = 2
            while True:
                suffixed = _clamp_with_suffix(base, f"-{i}")
                if suffixed not in used:
                    candidate = suffixed
                    break
                i += 1
        rename[name] = candidate
        used.add(candidate)

    if not rename:
        return  # idempotent no-op

    # 3. Rename collections table rows atomically using a VALUES-based UPDATE
    pairs = list(rename.items())
    values_sql = ", ".join(f"(:old_{i}, :new_{i})" for i in range(len(pairs)))
    params = {}
    for i, (old, new) in enumerate(pairs):
        params[f"old_{i}"] = old
        params[f"new_{i}"] = new
    conn.execute(sa.text(
        f"UPDATE collections SET name = m.new_name, updated_at = now() "
        f"FROM (VALUES {values_sql}) AS m(old_name, new_name) "
        f"WHERE collections.name = m.old_name"
    ), params)

    # 4. Rewrite skill.collections arrays — apply each rename pair
    for old, new in pairs:
        conn.execute(sa.text(
            "UPDATE skills SET collections = array_replace(collections, :old, :new) "
            "WHERE :old = ANY(collections)"
        ), {"old": old, "new": new})


def downgrade() -> None:
    # Cannot recover original casing/punctuation without a pre-migration stash
    pass
