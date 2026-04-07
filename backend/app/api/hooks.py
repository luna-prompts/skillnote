import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db

router = APIRouter(prefix="/v1/hooks", tags=["hooks"])


class SkillUsedPayload(BaseModel):
    skill_slug: str = Field(..., max_length=128)
    agent_name: str = Field(default="claude-code", max_length=128)
    session_id: str = Field(default="", max_length=256)


class SessionEvalPayload(BaseModel):
    skill_slug: str = Field(..., max_length=128)
    evaluation: str = Field(..., max_length=2000)
    session_id: str = Field(default="", max_length=256)


@router.post("/skill-used", status_code=202)
def skill_used(payload: SkillUsedPayload, db: Session = Depends(get_db)):
    """Receive PostToolUse[Skill] analytics from the Claude Code plugin hook."""
    if not payload.skill_slug:
        return {"status": "ignored", "reason": "missing skill_slug"}

    db.execute(
        text(
            "INSERT INTO skill_call_events "
            "(id, skill_slug, event_type, agent_name, agent_version, session_id, collection_scope, remote_ip) "
            "VALUES (:id, :slug, 'called', :agent, '', :session, NULL, 'plugin-hook')"
        ),
        {
            "id": str(uuid.uuid4()),
            "slug": payload.skill_slug,
            "agent": payload.agent_name,
            "session": payload.session_id,
        },
    )
    db.commit()
    return {"status": "accepted"}


@router.post("/session-eval", status_code=202)
def session_eval(payload: SessionEvalPayload, db: Session = Depends(get_db)):
    """Receive Haiku auto-evaluation results from the Stop hook."""
    if not payload.skill_slug or not payload.evaluation:
        return {"status": "ignored"}

    db.execute(
        text(
            "INSERT INTO skill_call_events "
            "(id, skill_slug, event_type, agent_name, agent_version, session_id, collection_scope, remote_ip) "
            "VALUES (:id, :slug, 'eval', 'plugin-hook', '', :session, NULL, :eval)"
        ),
        {
            "id": str(uuid.uuid4()),
            "slug": payload.skill_slug,
            "eval": payload.evaluation[:500],
            "session": payload.session_id,
        },
    )
    db.commit()
    return {"status": "accepted"}
