from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.security import hash_token
from app.db.models import AccessToken
from app.db.session import get_db


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid Authorization header")
    return parts[1].strip()


def get_current_token(
    authorization: str | None = Header(default=None), db: Session = Depends(get_db)
) -> AccessToken:
    token = _extract_bearer_token(authorization)
    token_hash = hash_token(token)

    token_row = db.query(AccessToken).filter(AccessToken.token_hash == token_hash).first()
    if not token_row:
        raise HTTPException(status_code=401, detail="Invalid token")
    if token_row.status != "active":
        raise HTTPException(status_code=401, detail="Token inactive")
    if token_row.expires_at and token_row.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Token expired")

    return token_row
