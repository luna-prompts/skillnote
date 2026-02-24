import hashlib
from datetime import datetime, timezone

from app.core.config import settings
from app.db.models import AccessToken


def hash_token(token: str) -> str:
    raw = f"{settings.token_pepper}:{token}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def is_token_valid(token_row: AccessToken) -> bool:
    if token_row.status != "active":
        return False
    if token_row.expires_at and token_row.expires_at < datetime.now(timezone.utc):
        return False
    return True
