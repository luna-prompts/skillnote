"""slugify collection names

Revision ID: 0012_slugify_collection_names
Revises: 0011_collections_table
Create Date: 2026-04-18
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

    # 2. Build the rename map with collision resolution
    rename: dict[str, str] = {}
    used: set[str] = set()
    for name, _created in rows:
        if NAME_PATTERN.match(name) and len(name) <= MAX_LEN:
            used.add(name)
            continue
        candidate = _slugify(name) or _fallback(name)
        if candidate in used:
            base = candidate
            i = 2
            while f"{base}-{i}" in used:
                i += 1
            candidate = f"{base}-{i}"
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
