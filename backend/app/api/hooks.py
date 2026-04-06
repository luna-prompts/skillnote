import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db

router = APIRouter(prefix="/v1/hooks", tags=["hooks"])


@router.post("/skill-used", status_code=202)
def skill_used(payload: dict, db: Session = Depends(get_db)):
    """Receive PostToolUse[Skill] analytics from the Claude Code plugin hook."""
    skill_slug = payload.get("skill_slug", "")
    agent_name = payload.get("agent_name", "claude-code")
    session_id = payload.get("session_id", "")

    if not skill_slug:
        return {"status": "ignored", "reason": "missing skill_slug"}

    db.execute(
        text(
            "INSERT INTO skill_call_events "
            "(id, skill_slug, event_type, agent_name, agent_version, session_id, collection_scope, remote_ip) "
            "VALUES (:id, :slug, 'called', :agent, '', :session, NULL, 'plugin-hook')"
        ),
        {
            "id": str(uuid.uuid4()),
            "slug": skill_slug,
            "agent": agent_name,
            "session": session_id,
        },
    )
    db.commit()
    return {"status": "accepted"}


@router.post("/session-eval", status_code=202)
def session_eval(payload: dict, db: Session = Depends(get_db)):
    """Receive Haiku auto-evaluation results from the Stop hook."""
    # Store as a generic event for now — can be refined later
    skill_slug = payload.get("skill_slug", "")
    evaluation = payload.get("evaluation", "")
    session_id = payload.get("session_id", "")

    if not skill_slug or not evaluation:
        return {"status": "ignored"}

    db.execute(
        text(
            "INSERT INTO skill_call_events "
            "(id, skill_slug, event_type, agent_name, agent_version, session_id, collection_scope, remote_ip) "
            "VALUES (:id, :slug, 'eval', :eval, '', :session, NULL, 'plugin-hook')"
        ),
        {
            "id": str(uuid.uuid4()),
            "slug": skill_slug,
            "eval": evaluation[:500],
            "session": session_id,
        },
    )
    db.commit()
    return {"status": "accepted"}
