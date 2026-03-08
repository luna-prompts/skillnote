from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db

router = APIRouter(prefix="/v1/settings", tags=["settings"])

# Allowlist of known settings and their valid values
_VALID_SETTINGS: dict[str, set[str]] = {
    "complete_skill_enabled": {"true", "false"},
    "complete_skill_outcome_enabled": {"true", "false"},
}


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT key, value FROM settings")).mappings().all()
    return {row["key"]: row["value"] for row in rows}


@router.put("")
def update_settings(patch: dict[str, str], db: Session = Depends(get_db)):
    for key, value in patch.items():
        if key not in _VALID_SETTINGS:
            raise HTTPException(
                status_code=422,
                detail={"code": "INVALID_SETTING", "message": f"Unknown setting: {key}"},
            )
        if value not in _VALID_SETTINGS[key]:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "INVALID_VALUE",
                    "message": f"Invalid value for {key}: must be one of {sorted(_VALID_SETTINGS[key])}",
                },
            )

    for key, value in patch.items():
        db.execute(
            text(
                "INSERT INTO settings (key, value, updated_at) "
                "VALUES (:key, :value, now()) "
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()"
            ),
            {"key": key, "value": value},
        )
    db.execute(text("SELECT pg_notify('skillnote_skills_changed', 'settings')"))
    db.commit()
    return {"status": "ok"}
