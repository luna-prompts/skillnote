import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings

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
async def http_exception_handler(_: Request, exc: HTTPException):
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail and "message" in detail:
        payload = detail
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


@app.on_event("startup")
async def _check_embedding_config():
    from app.services import embedding_service
    if not embedding_service.is_configured():
        _skillnote_logger.warning(
            "SKILLNOTE_EMBEDDING_API_KEY is not set; "
            "/v1/openclaw/context-bundle will return 503 EMBEDDING_NOT_CONFIGURED. "
            "Set the env var to enable semantic skill ranking."
        )


@app.get("/health")
def health():
    return {"status": "ok"}
