from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import hash_token, is_token_valid
from app.db.models import AccessToken
from app.db.session import get_db
from app.schemas.auth import ValidateTokenRequest, ValidateTokenResponse, TokenSubject

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/validate-token", response_model=ValidateTokenResponse)
def validate_token(payload: ValidateTokenRequest, db: Session = Depends(get_db)):
    token_row = db.query(AccessToken).filter(AccessToken.token_hash == hash_token(payload.token)).first()

    if not token_row or not is_token_valid(token_row):
        return ValidateTokenResponse(valid=False)

    return ValidateTokenResponse(
        valid=True,
        subject=TokenSubject(type=token_row.subject_type, id=token_row.subject_id),
        expiresAt=token_row.expires_at,
    )
