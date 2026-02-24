from fastapi import FastAPI

from app.api.auth import router as auth_router
from app.api.skills import router as skills_router

app = FastAPI(title="SkillNote Backend", version="0.1.0")

app.include_router(auth_router)
app.include_router(skills_router)


@app.get("/health")
def health():
    return {"status": "ok"}
