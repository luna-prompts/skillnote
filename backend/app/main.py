import logging

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db

# Ensure our application loggers (skillnote.*) propagate to uvicorn's stdout
# handler. Uvicorn only configures its own loggers by default, so named app
# loggers stay silent unless we attach a handler or enable the root logger.
# We attach uvicorn's handler to "skillnote" — all child loggers inherit.
_skillnote_logger = logging.getLogger("skillnote")
if _skillnote_logger.level == logging.NOTSET:
    _skillnote_logger.setLevel(logging.INFO)
if not _skillnote_logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter(
        "%(levelname)s:     %(name)s: %(message)s"
    ))
    _skillnote_logger.addHandler(_handler)
# Don't propagate up to root (avoids double-logging if root is configured).
_skillnote_logger.propagate = False
from app.api.analytics import router as analytics_router
from app.api.skills import router as skills_router
from app.api.downloads import router as downloads_router
from app.api.publish import router as publish_router
from app.api.comments import router as comments_router
from app.api.settings import router as settings_router
from app.api.collections import router as collections_router
from app.api.hooks import router as hooks_router
from app.api.setup import router as setup_router
from app.api.sessions import router as sessions_router
from app.api.imports import router as imports_router
from app.api.marketplace import router as marketplace_router
from app.api.openclaw import router as openclaw_router, skill_router as openclaw_skill_router
from app.api.cli import router as cli_router

app = FastAPI(title="SkillNote Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(",") if settings.cors_origins != "*" else ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_https(request: Request, call_next):
    if settings.app_env == "prod" and settings.enforce_https_in_prod:
        proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        host = request.headers.get("host", "")
        if proto != "https" and not host.startswith("localhost") and not host.startswith("127.0.0.1"):
            return JSONResponse(
                status_code=400,
                content={"error": {"code": "HTTPS_REQUIRED", "message": "HTTPS is required in production"}},
            )
    return await call_next(request)


@app.exception_handler(HTTPException)
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    """
    R9 F57: also handle Starlette's HTTPException (raised by routing for
    unrouted paths) so EVERY 404/405 from this API comes back in the
    documented `{"error": {"code", "message"}}` shape — clients can rely
    on `body.error.code` being present.
    """
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail and "message" in detail:
        payload = detail
    elif exc.status_code == 404:
        payload = {"code": "NOT_FOUND", "message": str(detail) if detail else "Not Found"}
    elif exc.status_code == 405:
        payload = {"code": "METHOD_NOT_ALLOWED", "message": str(detail) if detail else "Method Not Allowed"}
    else:
        payload = {"code": "HTTP_ERROR", "message": str(detail)}
    return JSONResponse(status_code=exc.status_code, content={"error": payload})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError):
    """Wrap Pydantic/FastAPI validation errors in the standard error envelope.

    Without this handler, FastAPI returns `{"detail": [...]}`, which (a) breaks
    the frontend error-parsing contract (`body.error.message`), (b) echoes the
    raw user input back as `input` fields, and (c) leaks internal `ctx` keys.
    """
    errors = exc.errors()
    # Build a human-readable message from the first (or joined) errors.
    # Strip Pydantic-internal fields (`input`, `ctx`, `url`) before stringifying.
    messages = []
    for err in errors:
        loc = " → ".join(str(p) for p in err.get("loc", ()) if p != "body")
        msg = err.get("msg", "invalid")
        # Pydantic wraps custom ValueErrors as "Value error, <real message>" — strip the prefix
        if msg.startswith("Value error, "):
            msg = msg[len("Value error, "):]
        if loc:
            messages.append(f"{loc}: {msg}")
        else:
            messages.append(msg)
    message = "; ".join(messages) if messages else "Validation failed"
    return JSONResponse(
        status_code=422,
        content={"error": {"code": "VALIDATION_ERROR", "message": message}},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(_: Request, exc: Exception):
    """Catch unhandled exceptions — never leak stack traces to clients."""
    import logging
    logging.getLogger("skillnote").exception("Unhandled exception")
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": "Internal server error"}},
    )


app.include_router(skills_router)
app.include_router(downloads_router)
app.include_router(publish_router)
app.include_router(comments_router)
app.include_router(analytics_router)
app.include_router(settings_router)
app.include_router(collections_router)
app.include_router(hooks_router)
app.include_router(setup_router)
app.include_router(sessions_router)
app.include_router(imports_router)
app.include_router(marketplace_router)
app.include_router(openclaw_router)
app.include_router(openclaw_skill_router)
app.include_router(cli_router)


@app.get("/health")
def health(db: Session = Depends(get_db)):
    """
    R9 F56: production-grade health endpoint.

    Returns:
      - status:    "ok" if reachable + DB query succeeded, otherwise "degraded"
      - db:        "ok" if a trivial SELECT succeeds, otherwise the error class
      - migration: current head from alembic_version (lets ops detect when a
                   running container is behind the migrations baked into a
                   newer image — exactly the F44 surface)

    Keeping the response shape backwards-compatible: `status: "ok"` remains
    the load-bearing field for existing callers (install.sh wait loop,
    npx skillnote status, README curl examples). New fields are additive.
    """
    db_status: str = "ok"
    migration_version: str | None = None
    try:
        # Trivial query — exercises the connection pool + transactional path.
        db.execute(text("SELECT 1")).scalar_one()
        try:
            row = db.execute(text("SELECT version_num FROM alembic_version")).first()
            migration_version = row[0] if row else None
        except Exception:  # noqa: BLE001
            # alembic_version doesn't exist on a freshly-init'd DB before
            # the first `alembic upgrade head` — that's OK, leave as None.
            migration_version = None
    except Exception as exc:  # noqa: BLE001
        db_status = type(exc).__name__

    return {
        "status": "ok" if db_status == "ok" else "degraded",
        "db": db_status,
        "migration": migration_version,
    }
