from fastapi.testclient import TestClient

from app.main import app
from app.core.config import settings


def test_https_enforced_in_prod(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "prod")
    monkeypatch.setattr(settings, "enforce_https_in_prod", True)

    client = TestClient(app)
    r = client.get("/health", headers={"host": "skills.company.internal", "x-forwarded-proto": "http"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "HTTPS_REQUIRED"


def test_https_not_enforced_for_localhost(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "prod")
    monkeypatch.setattr(settings, "enforce_https_in_prod", True)

    client = TestClient(app)
    r = client.get("/health", headers={"host": "localhost:8080", "x-forwarded-proto": "http"})
    assert r.status_code == 200
