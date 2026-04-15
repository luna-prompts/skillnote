from datetime import datetime, timezone

from fastapi import APIRouter, Depends, status as http_status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.models import Collection
from app.db.session import get_db
from app.schemas.collection import CollectionCreate, CollectionDetail, CollectionUpdate

router = APIRouter(prefix="/v1/collections", tags=["collections"])


@router.get("")
def list_collections(db: Session = Depends(get_db)):
    """Return collection names + skill counts + description.

    UNIONs collections-with-skills (derived from skills.collections arrays)
    with explicitly-created empty collections from the collections table.
    """
    rows = db.execute(
        text(
            """
            SELECT name, count, COALESCE(c.description, '') AS description
            FROM (
                SELECT name, COUNT(*) AS count FROM (
                    SELECT unnest(collections) AS name FROM skills
                    WHERE collections IS NOT NULL AND collections != '{}'
                ) sub GROUP BY name
                UNION
                SELECT name, 0 AS count FROM collections
                WHERE name NOT IN (
                    SELECT DISTINCT unnest(collections) FROM skills
                    WHERE collections IS NOT NULL AND collections != '{}'
                )
            ) u
            LEFT JOIN collections c USING (name)
            ORDER BY name
            """
        )
    ).mappings().all()
    return [
        {"name": row["name"], "count": row["count"], "description": row["description"]}
        for row in rows
    ]


@router.post("", response_model=CollectionDetail, status_code=http_status.HTTP_201_CREATED)
def create_collection(payload: CollectionCreate, db: Session = Depends(get_db)):
    existing = db.query(Collection).filter(Collection.name == payload.name).first()
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
    db.refresh(col)
    return col


@router.put("/{name}", response_model=CollectionDetail)
def update_collection(name: str, payload: CollectionUpdate, db: Session = Depends(get_db)):
    col = db.query(Collection).filter(Collection.name == name).first()
    if not col:
        raise api_error(404, "COLLECTION_NOT_FOUND", f'Collection "{name}" not found')

    col.description = payload.description
    col.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(col)
    return col


@router.delete("/{name}", status_code=http_status.HTTP_204_NO_CONTENT)
def delete_collection(name: str, db: Session = Depends(get_db)):
    skill_ref_count = db.execute(
        text(
            "SELECT COUNT(*) FROM skills WHERE :name = ANY(collections)"
        ),
        {"name": name},
    ).scalar()

    if skill_ref_count and skill_ref_count > 0:
        raise api_error(
            409,
            "COLLECTION_IN_USE",
            f'Cannot delete "{name}": {skill_ref_count} skill(s) still reference it',
        )

    col = db.query(Collection).filter(Collection.name == name).first()
    if not col:
        raise api_error(404, "COLLECTION_NOT_FOUND", f'Collection "{name}" not found')

    db.delete(col)
    db.commit()
    return None
