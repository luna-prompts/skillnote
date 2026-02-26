from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.core.config import settings
from app.api.skills import router as skills_router
from app.api.downloads import router as downloads_router
from app.api.publish import router as publish_router
from app.api.comments import router as comments_router
from app.api.tags_api import router as tags_router

app = FastAPI(title="SkillNote Backend", version="0.1.0")

origins = [o.strip() for o in settings.cors_origins.split(',') if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
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


app.include_router(auth_router)
app.include_router(skills_router)
app.include_router(downloads_router)
app.include_router(publish_router)
app.include_router(comments_router)
app.include_router(tags_router)


@app.get("/health")
def health():
    return {"status": "ok"}
