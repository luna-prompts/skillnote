"""Tests for the /v1/cli/jobs bridge API.

The bridge is in-memory and request-scoped state lives in the module itself,
so each test resets the store to avoid leakage between cases.
"""
import asyncio
import time

import pytest
from fastapi.testclient import TestClient

from app.api import cli as cli_module
from app.main import app


@pytest.fixture(autouse=True)
def _reset_store():
    cli_module._jobs.clear()
    cli_module._pending_event.clear()
    yield
    cli_module._jobs.clear()


@pytest.fixture
def client():
    return TestClient(app)


def test_create_job_returns_201_and_id(client):
    r = client.post("/v1/cli/jobs", json={"type": "connect", "agent": "claude-code"})
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "pending"
    assert body["type"] == "connect"
    assert body["agent"] == "claude-code"
    assert body["id"]


def test_create_job_rejects_invalid_type(client):
    r = client.post("/v1/cli/jobs", json={"type": "not-a-type", "agent": "claude-code"})
    assert r.status_code == 400
    assert "INVALID_JOB_TYPE" in r.text


def test_create_job_rejects_empty_agent(client):
    r = client.post("/v1/cli/jobs", json={"type": "connect", "agent": ""})
    assert r.status_code == 400
    assert "INVALID_AGENT" in r.text


def test_pending_returns_null_when_no_jobs(client):
    r = client.get("/v1/cli/jobs/pending", params={"timeout": 0.1})
    assert r.status_code == 200
    assert r.json() is None


def test_pending_returns_job_after_create(client):
    created = client.post(
        "/v1/cli/jobs",
        json={"type": "connect", "agent": "openclaw"},
    ).json()
    r = client.get("/v1/cli/jobs/pending", params={"timeout": 1.0})
    assert r.status_code == 200
    body = r.json()
    assert body is not None
    assert body["id"] == created["id"]
    assert body["status"] == "pending"


def test_claim_marks_job_running(client):
    job = client.post("/v1/cli/jobs", json={"type": "connect", "agent": "openclaw"}).json()
    r = client.post(f"/v1/cli/jobs/{job['id']}/claim")
    assert r.status_code == 200
    assert r.json()["status"] == "running"
    assert r.json()["claimed_at"] is not None


def test_log_append_records_lines(client):
    job = client.post("/v1/cli/jobs", json={"type": "connect", "agent": "openclaw"}).json()
    client.post(f"/v1/cli/jobs/{job['id']}/claim")
    for line in ["first", "second", "third"]:
        r = client.post(f"/v1/cli/jobs/{job['id']}/log", json={"line": line})
        assert r.status_code == 200
    r = client.get(f"/v1/cli/jobs/{job['id']}")
    assert r.json()["log"] == ["first", "second", "third"]


def test_done_sets_status_succeeded_on_exit_zero(client):
    job = client.post("/v1/cli/jobs", json={"type": "connect", "agent": "openclaw"}).json()
    client.post(f"/v1/cli/jobs/{job['id']}/claim")
    r = client.post(f"/v1/cli/jobs/{job['id']}/done", json={"exit_code": 0})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "succeeded"
    assert body["exit_code"] == 0


def test_done_sets_status_failed_on_nonzero_exit(client):
    job = client.post("/v1/cli/jobs", json={"type": "connect", "agent": "openclaw"}).json()
    client.post(f"/v1/cli/jobs/{job['id']}/claim")
    r = client.post(f"/v1/cli/jobs/{job['id']}/done", json={"exit_code": 1, "error": "boom"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "failed"
    assert body["exit_code"] == 1
    assert body["error"] == "boom"


def test_get_nonexistent_returns_404(client):
    r = client.get("/v1/cli/jobs/does-not-exist")
    assert r.status_code == 404


def test_cancel_marks_job_cancelled(client):
    job = client.post("/v1/cli/jobs", json={"type": "connect", "agent": "openclaw"}).json()
    r = client.delete(f"/v1/cli/jobs/{job['id']}")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"


def test_list_includes_created_jobs(client):
    client.post("/v1/cli/jobs", json={"type": "connect", "agent": "openclaw"})
    client.post("/v1/cli/jobs", json={"type": "disconnect", "agent": "claude-code"})
    r = client.get("/v1/cli/jobs")
    assert r.status_code == 200
    assert r.json()["count"] == 2


def test_log_lines_capped_at_2000(client):
    job = client.post("/v1/cli/jobs", json={"type": "connect", "agent": "openclaw"}).json()
    # Exceed the cap and verify the store didn't grow past 2000 entries.
    for i in range(2010):
        client.post(f"/v1/cli/jobs/{job['id']}/log", json={"line": f"line {i}"})
    r = client.get(f"/v1/cli/jobs/{job['id']}")
    assert len(r.json()["log"]) == 2000
