"""HTTP routes for /v1/import/*.

Wraps the offline input parser (Task 2) + pre-flight security gates (Task 4) +
inspector service (Task 6) with error-code → HTTP-status mapping. All errors
return the standard `{"error": {"code": ..., "message": ...}}` envelope via
the global HTTPException handler in app/main.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.core.errors import api_error
from app.schemas.imports import (
    InspectRequest,
    InspectResponse,
    InspectResponseSource,
    InspectSkill,
)
from app.services.imports.input_parser import parse_input
from app.services.imports.security import validate_import_url, SecurityError
from app.services.imports.inspector import inspect_source


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
