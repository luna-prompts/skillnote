from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db

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
