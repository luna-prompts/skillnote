from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


ROOT = Path(__file__).resolve().parents[2]


def test_health_endpoint_returns_ok():
    client = TestClient(app)
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_smoke_script_has_required_steps():
    script = (ROOT / "scripts" / "smoke_test.sh").read_text()

    required_snippets = [
        "docker compose up --build -d",
        "python scripts/wait_for_db.py",
        "alembic upgrade head",
        "python scripts/seed_data.py",
        "http://127.0.0.1:8080/health",
        "select count(*) as skills from skills;",
    ]

    for snippet in required_snippets:
        assert snippet in script


def test_compose_has_default_api_port_mapping():
    compose = (ROOT / "docker-compose.yml").read_text()
    assert "${YOURSKILLS_API_PORT:-8082}:8080" in compose
