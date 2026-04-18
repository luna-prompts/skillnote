"""HTTP routes for /v1/import/*.

Wraps the offline input parser (Task 2) + pre-flight security gates (Task 4) +
inspector service (Task 6) with error-code → HTTP-status mapping. All errors
return the standard `{"error": {"code": ..., "message": ...}}` envelope via
the global HTTPException handler in app/main.py.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.session import get_db
from app.schemas.imports import (
    ApplyRequest,
    ApplyResponse,
    ApplyResponseSkill,
    InspectRequest,
    InspectResponse,
    InspectResponseSource,
    InspectSkill,
)
from app.services.imports.input_parser import parse_input
from app.services.imports.security import validate_import_url, SecurityError
from app.services.imports.inspector import inspect_source
from app.services.imports.importer import apply_import, ImportError as ImportErr


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
