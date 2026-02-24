from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from app.api.auth import router as auth_router
from app.api.skills import router as skills_router
from app.api.downloads import router as downloads_router
from app.api.publish import router as publish_router

app = FastAPI(title="SkillNote Backend", version="0.1.0")


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


@app.get("/health")
def health():
    return {"status": "ok"}
