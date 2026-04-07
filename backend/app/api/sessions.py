import secrets
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.session import get_db


class ResolveSessionPayload(BaseModel):
    collections: List[str] = Field(..., min_length=1, max_length=50)

router = APIRouter(prefix="/v1/sessions", tags=["sessions"])

SESSION_TTL_MINUTES = 10


@router.post("", status_code=201)
def create_pick_session(request: Request, db: Session = Depends(get_db)):
    """Create a pick session. Returns a token and URL for the web UI picker."""
    import os
    token = secrets.token_urlsafe(24)
    expires = datetime.now(timezone.utc) + timedelta(minutes=SESSION_TTL_MINUTES)

    db.execute(
        text(
            "INSERT INTO collection_pick_sessions (token, status, expires_at) "
            "VALUES (:token, 'pending', :expires)"
        ),
        {"token": token, "expires": expires},
    )
    db.commit()

    # Derive the web URL for the pick page
    host = request.headers.get("host", "localhost:8082").split(":")[0]
    web_url = os.environ.get("SKILLNOTE_WEB_URL", f"http://{host}:3000")
    pick_url = f"{web_url}/collections/pick?token={token}"

    return {
        "token": token,
        "pick_url": pick_url,
        "expires_at": expires.isoformat(),
    }


@router.get("/{token}")
def get_pick_session(token: str, db: Session = Depends(get_db)):
    """Poll a pick session. Returns status and collections when completed."""
    row = db.execute(
        text(
            "SELECT status, result_collections FROM collection_pick_sessions "
            "WHERE token = :token AND expires_at > now()"
        ),
        {"token": token},
    ).mappings().first()

    if not row:
        raise api_error(404, "SESSION_NOT_FOUND", "Session not found or expired")

    return {
        "status": row["status"],
        "collections": list(row["result_collections"]) if row["result_collections"] else None,
    }


@router.post("/{token}/resolve")
def resolve_pick_session(token: str, payload: ResolveSessionPayload, db: Session = Depends(get_db)):
    """Resolve a pick session with the user's collection selection."""
    collections = payload.collections

    result = db.execute(
        text(
            "UPDATE collection_pick_sessions SET status = 'completed', "
            "result_collections = :cols, resolved_at = now() "
            "WHERE token = :token AND status = 'pending' AND expires_at > now()"
        ),
        {"cols": collections, "token": token},
    )
    db.commit()

    if result.rowcount == 0:
        raise api_error(404, "SESSION_NOT_FOUND", "Session not found, expired, or already resolved")

    return {"status": "ok", "collections": collections}
