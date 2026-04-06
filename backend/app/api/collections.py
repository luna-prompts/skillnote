from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db

router = APIRouter(prefix="/v1/collections", tags=["collections"])


@router.get("")
def list_collections(db: Session = Depends(get_db)):
    """Return distinct collection names with skill counts."""
    rows = db.execute(
        text(
            "SELECT name, COUNT(*) AS count FROM ("
            "  SELECT unnest(collections) AS name FROM skills "
            "  WHERE collections IS NOT NULL AND collections != '{}'"
            ") sub GROUP BY name ORDER BY name"
        )
    ).mappings().all()
    return [{"name": row["name"], "count": row["count"]} for row in rows]
