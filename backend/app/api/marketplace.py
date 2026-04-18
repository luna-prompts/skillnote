"""Claude-Code-compatible publish-back endpoint.

Consumers add ``http://<host>/marketplace/<slug>.json`` as a marketplace source
in their Claude Code settings and receive a manifest listing the imported skills
in that collection as git-subdir plugins (see Task 7 publisher).

Read-only. Supports HTTP cache validation via ETag/If-None-Match.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.models import Collection
from app.db.session import get_db
from app.services.imports.publisher import compute_etag, serialize_collection
from app.services.imports.rate_limit import check_marketplace_rate


router = APIRouter(prefix="/marketplace", tags=["marketplace"])
logger = logging.getLogger("skillnote.marketplace")

# Narrow slug regex: matches collection_validator rules + prevents arbitrary
# strings (including path traversal chars) from reaching the SQL lookup.
_SLUG_RE = re.compile(r"^[a-z0-9_-]+$")


def _err_code(e: HTTPException) -> str | None:
    """Extract the error code from an HTTPException detail (dict or str)."""
    if isinstance(e.detail, dict):
        return e.detail.get("code")
    return str(e.detail) if e.detail else None


@router.get("/{slug}.json", dependencies=[Depends(check_marketplace_rate)])
def publish(
    slug: str,
    response: Response,
    if_none_match: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    try:
        if not _SLUG_RE.match(slug):
            raise api_error(404, "NOT_FOUND", "Collection not found")

        c = db.get(Collection, slug)
        if c is None:
            raise api_error(404, "NOT_FOUND", "Collection not found")

        manifest = serialize_collection(db, slug)
        etag = compute_etag(manifest)

        if if_none_match == etag:
            # 304 carries no body and no ETag — client already has the current one.
            logger.info(
                "marketplace.publish cache_hit",
                extra={
                    "slug": slug,
                    "outcome": "ok",
                    "status": 304,
                },
            )
            return Response(status_code=304)

        response.headers["ETag"] = etag
        response.headers["Cache-Control"] = "public, max-age=60, must-revalidate"
        logger.info(
            "marketplace.publish ok",
            extra={
                "slug": slug,
                "outcome": "ok",
                "plugin_count": len(manifest.get("plugins", [])),
                "status": 200,
            },
        )
        return manifest
    except HTTPException as e:
        logger.info(
            "marketplace.publish error",
            extra={
                "slug": slug,
                "outcome": "error",
                "code": _err_code(e),
                "status": e.status_code,
            },
        )
        raise
