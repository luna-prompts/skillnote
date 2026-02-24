from datetime import datetime

from pydantic import BaseModel


class ValidateTokenRequest(BaseModel):
    token: str


class TokenSubject(BaseModel):
    type: str
    id: str


class ValidateTokenResponse(BaseModel):
    valid: bool
    subject: TokenSubject | None = None
    expiresAt: datetime | None = None
