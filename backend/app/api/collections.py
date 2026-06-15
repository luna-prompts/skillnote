from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response, status as http_status
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.models import Collection
from app.db.session import get_db
from app.schemas.collection import (
    CollectionCreate,
    CollectionDetail,
    CollectionPublishUpdate,
    CollectionUpdate,
)

router = APIRouter(prefix="/v1/collections", tags=["collections"])


@router.get("")
def list_collections(
    response: Response,
    db: Session = Depends(get_db),
    q: Optional[str] = None,
    published: Optional[bool] = None,
    limit: int = Query(default=0, ge=0, le=500),
):
    """Return collection names + skill counts + description.

    UNIONs collections-with-skills (derived from skills.collections arrays)
    with explicitly-created empty collections from the collections table.
    Uses LOWER() throughout so case variants are merged, not duplicated.

    Scale knobs (all optional, additive — no params keeps the original
    full-list behavior the web app relies on):
    - ``q``         case-insensitive substring filter on the name
    - ``published`` filter by claude.ai publish state (the extension popup
                    fetches its enabled set with ``published=true``)
    - ``limit``     cap returned rows (0 = no cap, max 500)

    The TRUE total for the active filters (pre-limit) is returned in the
    ``X-Total-Count`` header so pickers can render "N collections" without
    ever pulling thousands of rows.
    """
    base_sql = """
        FROM (
            SELECT name, COUNT(*) AS count FROM (
                SELECT unnest(collections) AS name FROM skills
                WHERE collections IS NOT NULL AND collections != '{}'
            ) sub GROUP BY name
            UNION
            SELECT name, 0 AS count FROM collections
            WHERE lower(name) NOT IN (
                SELECT DISTINCT lower(unnest(collections)) FROM skills
                WHERE collections IS NOT NULL AND collections != '{}'
            )
        ) u
        LEFT JOIN collections c ON lower(c.name) = lower(u.name)
    """
    where: list[str] = []
    params: dict = {}
    if q:
        where.append("lower(u.name) LIKE '%' || lower(:q) || '%'")
        params["q"] = q
    if published is not None:
        where.append("COALESCE(c.published_to_claude_ai, false) = :published")
        params["published"] = published
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""

    total = db.execute(
        text(f"SELECT COUNT(*) {base_sql}{where_sql}"), params
    ).scalar_one()
    response.headers["X-Total-Count"] = str(total)

    limit_sql = " LIMIT :limit" if limit > 0 else ""
    if limit > 0:
        params["limit"] = limit
    rows = db.execute(
        text(
            f"""
            SELECT u.name, u.count,
                   COALESCE(c.description, '') AS description,
                   COALESCE(c.published_to_claude_ai, false) AS published_to_claude_ai
            {base_sql}{where_sql}
            ORDER BY u.name{limit_sql}
            """
        ),
        params,
    ).mappings().all()
    return [
        {
            "name": row["name"],
            "count": row["count"],
            "description": row["description"],
            "published_to_claude_ai": row["published_to_claude_ai"],
        }
        for row in rows
    ]


@router.get("/{name}", response_model=CollectionDetail)
def get_collection(name: str, db: Session = Depends(get_db)):
    """Fetch a single collection by name (case-insensitive)."""
    col = db.query(Collection).filter(
        func.lower(Collection.name) == name.lower()
    ).first()
    if not col:
        raise api_error(404, "COLLECTION_NOT_FOUND", f'Collection "{name}" not found')
    return col


@router.post("", response_model=CollectionDetail, status_code=http_status.HTTP_201_CREATED)
def create_collection(payload: CollectionCreate, db: Session = Depends(get_db)):
    existing = db.query(Collection).filter(
        func.lower(Collection.name) == payload.name.strip().lower()
    ).first()
    if existing:
        raise api_error(409, "COLLECTION_EXISTS", f'Collection "{payload.name}" already exists')

    now = datetime.now(timezone.utc)
    col = Collection(
        name=payload.name,
        description=payload.description,
        created_at=now,
        updated_at=now,
    )
    db.add(col)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise api_error(409, "COLLECTION_EXISTS", f'Collection "{payload.name}" already exists')
    return db.query(Collection).filter(Collection.name == col.name).first()


@router.put("/{name}", response_model=CollectionDetail)
def update_collection(name: str, payload: CollectionUpdate, db: Session = Depends(get_db)):
    col = db.query(Collection).filter(
        func.lower(Collection.name) == name.lower()
    ).first()
    if not col:
        raise api_error(404, "COLLECTION_NOT_FOUND", f'Collection "{name}" not found')

    col.description = payload.description
    col.updated_at = datetime.now(timezone.utc)
    # The description is shipped into the claude.ai plugin manifest, so a
    # published collection must re-publish to reflect the edit (otherwise the
    # claude.ai group keeps the stale description until some other change).
    if col.published_to_claude_ai:
        from app.services.claude_ai_sync import enqueue_group_publish

        enqueue_group_publish(db)
    db.commit()
    return db.query(Collection).filter(Collection.name == col.name).first()


@router.put("/{name}/claude-ai", response_model=CollectionDetail)
def set_collection_claude_ai_publish(
    name: str, payload: CollectionPublishUpdate, db: Session = Depends(get_db)
):
    """Toggle whether a collection is published to claude.ai as its own
    plugin group.

    Upserts a ``collections`` row if the collection currently exists only as a
    string in skill arrays (so there's somewhere to store the flag), sets
    ``published_to_claude_ai``, and enqueues a group republish so the extension
    rebuilds the claude.ai groups on its next tick. This is the backend behind
    the per-collection toggle on the collection card.
    """
    col = db.query(Collection).filter(
        func.lower(Collection.name) == name.lower()
    ).first()
    if not col:
        # Collection exists only via skill arrays — materialize a row so the
        # flag has a home. Use the EXACT casing stored in the skill arrays as
        # the row name (NOT the raw URL ``name``, whose casing may differ from
        # what skills store) so the published-group query matches the skills.
        ref = db.execute(
            text(
                "SELECT c FROM skills, unnest(collections) AS c "
                "WHERE lower(c) = lower(:name) LIMIT 1"
            ),
            {"name": name},
        ).first()
        if ref is None:
            raise api_error(404, "COLLECTION_NOT_FOUND", f'Collection "{name}" not found')
        now = datetime.now(timezone.utc)
        col = Collection(name=ref[0], description="", created_at=now, updated_at=now)
        db.add(col)

    col.published_to_claude_ai = payload.published
    col.updated_at = datetime.now(timezone.utc)

    # Trigger a claude.ai group rebuild on the next extension tick.
    from app.services.claude_ai_sync import enqueue_group_publish

    enqueue_group_publish(db)
    try:
        db.commit()
    except IntegrityError:
        # Race: a concurrent request materialized the same collection row
        # between our lookup and insert. Re-fetch the now-existing row, apply
        # the flag, and retry once (mirrors create_collection's handling).
        db.rollback()
        col = db.query(Collection).filter(
            func.lower(Collection.name) == name.lower()
        ).first()
        if col is None:
            raise api_error(404, "COLLECTION_NOT_FOUND", f'Collection "{name}" not found')
        col.published_to_claude_ai = payload.published
        col.updated_at = datetime.now(timezone.utc)
        enqueue_group_publish(db)
        db.commit()
    return db.query(Collection).filter(Collection.name == col.name).first()


@router.delete("/{name}", status_code=http_status.HTTP_204_NO_CONTENT)
def delete_collection(name: str, db: Session = Depends(get_db)):
    # Check if any skills still reference this collection (case-insensitive)
    skill_ref_count = db.execute(
        text(
            "SELECT COUNT(*) FROM skills WHERE EXISTS ("
            "  SELECT 1 FROM unnest(collections) AS c WHERE lower(c) = lower(:name)"
            ")"
        ),
        {"name": name},
    ).scalar()

    if skill_ref_count and skill_ref_count > 0:
        raise api_error(
            409,
            "COLLECTION_IN_USE",
            f'Cannot delete "{name}": {skill_ref_count} skill(s) still reference it',
        )

    col = db.query(Collection).filter(
        func.lower(Collection.name) == name.lower()
    ).first()
    if not col:
        raise api_error(404, "COLLECTION_NOT_FOUND", f'Collection "{name}" not found')

    db.delete(col)
    db.commit()
    return None
