"""HTTP routes for /v1/import/*.

Wraps the offline input parser (Task 2) + pre-flight security gates (Task 4) +
inspector service (Task 6) with error-code → HTTP-status mapping. All errors
return the standard `{"error": {"code": ..., "message": ...}}` envelope via
the global HTTPException handler in app/main.py.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.models import ImportSource, Skill
from app.db.session import get_db
from app.schemas.imports import (
    ApplyRequest,
    ApplyResponse,
    ApplyResponseSkill,
    InspectRequest,
    InspectResponse,
    InspectResponseSource,
    InspectSkill,
    RefreshRequest,
    SourceListItem,
)
from app.services.imports.input_parser import parse_input
from app.services.imports.security import validate_import_url, SecurityError
from app.services.imports.inspector import inspect_source
from app.services.imports.importer import apply_import, ImportError as ImportErr
from app.services.imports.refresher import probe_head_sha


router = APIRouter(prefix="/v1/import", tags=["imports"])


# Map inspector error codes → HTTP status.
_INSPECT_ERROR_STATUS = {
    "REPO_NOT_FOUND": 404,
    "REPO_PRIVATE": 401,
    "RATE_LIMITED": 429,
    "UPSTREAM_TIMEOUT": 504,
    "UNSUPPORTED_SOURCE_TYPE": 400,
    "INPUT_UNPARSEABLE": 400,
}


@router.post("/inspect", response_model=InspectResponse)
def inspect_endpoint(body: InspectRequest) -> InspectResponse:
    parsed = parse_input(body.input)
    if parsed is None:
        raise api_error(
            400,
            "INPUT_UNPARSEABLE",
            "Try 'owner/repo', a git URL, or a .json URL",
        )
    if "error" in parsed:
        raise api_error(400, "INPUT_UNPARSEABLE", parsed["error"])

    # Apply security gates on any full URL we might hit. For github shorthand
    # we synthesize the equivalent https URL — the inspector only hits the
    # GitHub API (or a test MockServer via SKILLNOTE_IMPORT_GITHUB_API_BASE),
    # but the scheme/host policy still applies to the user-visible source.
    url_for_check = parsed.get("url") or f"https://github.com/{parsed.get('repo')}"
    try:
        validate_import_url(url_for_check)
    except SecurityError as e:
        # SecurityError message is the code (e.g. "URL_SCHEME_FORBIDDEN").
        raise api_error(400, str(e), "URL rejected by security policy")

    if body.subpath:
        parsed["subpath"] = body.subpath

    result = inspect_source(parsed, token=body.github_token, timeout_s=30)

    if result.error_code:
        code = result.error_code
        status = _INSPECT_ERROR_STATUS.get(code, 500)
        raise api_error(status, code, result.error_message or code)

    suggested = None
    if result.owner and result.repo:
        suggested = f"{result.owner}-{result.repo}".lower()

    return InspectResponse(
        source=InspectResponseSource(
            source_type=result.source_type or "unknown",
            url=result.url,
            host=result.host,
            owner=result.owner,
            repo=result.repo,
            ref=result.ref,
            resolved_sha=result.resolved_sha,
            subpath=result.subpath,
        ),
        kind=result.kind,
        skills=[InspectSkill(**s) for s in result.skills],
        manifest=result.manifest,
        suggested_collection_slug=suggested,
    )


@router.post("/apply", response_model=ApplyResponse, status_code=201)
def apply_endpoint(body: ApplyRequest, db: Session = Depends(get_db)):
    parsed = parse_input(body.input)
    if parsed is None or "error" in parsed:
        raise api_error(400, "INPUT_UNPARSEABLE", "Unable to parse input")

    url_for_check = parsed.get("url") or f"https://github.com/{parsed.get('repo')}"
    try:
        validate_import_url(url_for_check)
    except SecurityError as e:
        raise api_error(400, str(e), "URL rejected by security policy")

    if body.subpath:
        parsed["subpath"] = body.subpath
    result = inspect_source(parsed, token=body.github_token, timeout_s=60)
    if result.error_code:
        status = _INSPECT_ERROR_STATUS.get(result.error_code, 500)
        raise api_error(status, result.error_code, result.error_message or result.error_code)

    target = body.target_collection_slug or (
        f"{result.owner}-{result.repo}".lower() if result.owner and result.repo else "imported"
    )
    try:
        out = apply_import(
            db, result, target,
            skill_selection=body.skill_selection,
            on_conflict=body.on_conflict,
        )
    except ImportErr as e:
        raise api_error(422, e.code, e.message)

    return ApplyResponse(
        source_id=out["source_id"],
        collection_slug=out["collection_slug"],
        imported=[ApplyResponseSkill(**s) for s in out["imported"]],
        skipped=out["skipped"],
    )


@router.get("/sources", response_model=List[SourceListItem])
def list_sources(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    sources = db.query(ImportSource).all()
    now = datetime.now(timezone.utc)
    ten_min_ago = now - timedelta(minutes=10)
    result = []
    for src in sources:
        skill_count = db.query(Skill).filter(Skill.import_source_id == src.id).count()
        result.append(SourceListItem(
            id=str(src.id),
            url=src.url,
            host=src.host, owner=src.owner, repo=src.repo, ref=src.ref,
            kind=src.kind, collection_slug=src.collection_name,
            pinned=src.pinned,
            imported_at_sha=src.imported_at_sha,
            upstream_sha=src.upstream_sha,
            last_synced_at=src.last_synced_at,
            last_checked_at=src.last_checked_at,
            status=src.status,
            skill_count=skill_count,
        ))
        eligible = (
            src.source_type == "github" and not src.pinned
            and (src.last_checked_at is None or src.last_checked_at < ten_min_ago)
        )
        if eligible:
            background_tasks.add_task(_probe_in_bg, src.id)
    return result


def _probe_in_bg(src_id):
    from app.db.session import SessionLocal
    with SessionLocal() as db:
        src = db.get(ImportSource, src_id)
        if src:
            probe_head_sha(src)
            db.commit()


def _coerce_source_id(source_id: str) -> uuid.UUID:
    """Coerce a path-param string into a UUID. Invalid → 404 (same as not-found)."""
    try:
        return uuid.UUID(source_id)
    except (ValueError, AttributeError, TypeError):
        raise api_error(404, "SOURCE_NOT_FOUND", "Import source not found")


@router.post("/sources/{source_id}/refresh")
def refresh_endpoint(source_id: str, body: RefreshRequest, db: Session = Depends(get_db)):
    sid = _coerce_source_id(source_id)
    src = db.get(ImportSource, sid)
    if not src:
        raise api_error(404, "SOURCE_NOT_FOUND", "Import source not found")

    if body.mode == "preview":
        probe_head_sha(src)
        db.commit()
        return {
            "source_id": str(src.id),
            "from_sha": src.imported_at_sha,
            "to_sha": src.upstream_sha,
            # v1 stub — full diff materialization arrives in v1.1.
            "new": [],
            "changed": [],
            "removed": [],
        }
    # "apply" — Literal validation guarantees mode is preview or apply.
    # v1 stub — full diff-apply arrives in v1.1.
    return {"applied": 0}


@router.delete("/sources/{source_id}", status_code=204)
def delete_source(
    source_id: str,
    remove_skills: bool = Query(False),
    db: Session = Depends(get_db),
):
    sid = _coerce_source_id(source_id)
    src = db.get(ImportSource, sid)
    if not src:
        raise api_error(404, "SOURCE_NOT_FOUND", "Import source not found")

    if remove_skills:
        db.query(Skill).filter(Skill.import_source_id == src.id).delete(
            synchronize_session=False
        )
    else:
        # Keep the skills but unlink: SET NULL + mark forked per spec.
        for skill in db.query(Skill).filter(Skill.import_source_id == src.id).all():
            skill.import_source_id = None
            skill.forked_from_source = True

    db.delete(src)
    db.commit()
    return None
