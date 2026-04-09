import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db

router = APIRouter(prefix="/v1/hooks", tags=["hooks"])


class SkillUsedPayload(BaseModel):
    """Accepts both direct POST and Claude Code HTTP hook format.
    Claude Code sends camelCase (toolName, toolInput, hookEventName, sessionId).
    We also accept snake_case for direct API calls."""
    model_config = {"populate_by_name": True}

    # Direct format
    skill_slug: Optional[str] = Field(default=None, max_length=128)
    agent_name: str = Field(default="claude-code", max_length=128, alias="agentName")
    session_id: Optional[str] = Field(default="", max_length=256, alias="sessionId")
    # HTTP hook format (PostToolUse event) — camelCase from Claude Code
    tool_name: Optional[str] = Field(default=None, alias="toolName")
    tool_input: Optional[dict] = Field(default=None, alias="toolInput")
    hook_event_name: Optional[str] = Field(default=None, alias="hookEventName")


class SessionEvalPayload(BaseModel):
    skill_slug: str = Field(..., max_length=128)
    evaluation: str = Field(..., max_length=2000)
    session_id: str = Field(default="", max_length=256)


@router.post("/skill-used", status_code=202)
def skill_used(payload: SkillUsedPayload, db: Session = Depends(get_db)):
    """Receive PostToolUse[Skill] analytics — supports both direct and HTTP hook format."""
    # Extract skill slug from either format
    slug = payload.skill_slug
    session = payload.session_id or ""

    if not slug and payload.tool_input:
        # HTTP hook format: tool_input has the skill name
        slug = payload.tool_input.get("name", "") or payload.tool_input.get("skill", "")

    if not slug and payload.hook_event_name:
        # Fallback: try tool_name
        slug = payload.tool_name or ""

    if not slug:
        return {"status": "ignored", "reason": "no skill identified"}

    # Normalize: strip skillnote- prefix so it matches the registry slug
    if slug.startswith("skillnote-"):
        slug = slug[len("skillnote-"):]

    # Extract session_id from HTTP hook format
    if not session and payload.hook_event_name:
        session = str(payload.session_id or "")

    db.execute(
        text(
            "INSERT INTO skill_call_events "
            "(id, skill_slug, event_type, agent_name, agent_version, session_id, collection_scope, remote_ip) "
            "VALUES (:id, :slug, 'called', :agent, '', :session, NULL, 'plugin-hook')"
        ),
        {
            "id": str(uuid.uuid4()),
            "slug": slug[:128],
            "agent": payload.agent_name[:128],
            "session": session[:256],
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
