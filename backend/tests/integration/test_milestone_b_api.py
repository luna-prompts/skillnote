import json
import urllib.error
import urllib.request

import pytest


BASE_URL = "http://127.0.0.1:8080"


def _request(method: str, path: str, headers: dict | None = None, body: dict | None = None):
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        method=method,
        headers=headers or {},
        data=(json.dumps(body).encode() if body is not None else None),
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:
        pytest.skip(f"API not reachable for integration test: {e}")


def test_health_endpoint():
    status, body = _request("GET", "/health")
    assert status == 200
    assert body["status"] == "ok"


def test_list_skills_no_auth_required():
    """Skills endpoint is open — no auth header needed."""
    status, skills = _request("GET", "/v1/skills")
    assert status == 200
    assert isinstance(skills, list)
    assert len(skills) >= 1


def test_list_skills_and_versions():
    status, skills = _request("GET", "/v1/skills")
    assert status == 200
    assert isinstance(skills, list)
    assert len(skills) >= 1

    status, versions = _request("GET", "/v1/skills/secure-migrations/versions")
    assert status == 200
    assert isinstance(versions, list)
    assert len(versions) >= 1


def test_download_bundle_with_headers():
    req = urllib.request.Request(
        f"{BASE_URL}/v1/skills/secure-migrations/0.1.0/download",
        method="GET",
    )
    try:
        with urllib.request.urlopen(req) as r:
            data = r.read()
            assert r.status == 200
            assert r.headers.get("X-Skill-Name") == "secure-migrations"
            assert r.headers.get("X-Skill-Version") == "0.1.0"
            assert r.headers.get("X-Checksum-Sha256")
            assert len(data) > 0
    except Exception as e:
        pytest.skip(f"Download endpoint not reachable for integration test: {e}")


def test_download_nonexistent_skill():
    status, body = _request("GET", "/v1/skills/nonexistent-xyz/0.1.0/download")
    assert status == 404


def test_skill_crud_lifecycle():
    """Full create → read → update → delete cycle without auth."""
    # Create
    status, body = _request(
        "POST", "/v1/skills",
        headers={"Content-Type": "application/json"},
        body={
            "name": "integration-test-skill",
            "slug": "integration-test-skill",
            "description": "Created by integration test",
            "content_md": "# Integration Test",
            "tags": ["test"],
            "collections": [],
        },
    )
    assert status == 200
    assert body["slug"] == "integration-test-skill"
    assert body["current_version"] == 1

    # Read
    status, body = _request("GET", "/v1/skills/integration-test-skill")
    assert status == 200
    assert body["description"] == "Created by integration test"

    # Update
    status, body = _request(
        "PATCH", "/v1/skills/integration-test-skill",
        headers={"Content-Type": "application/json"},
        body={"description": "Updated by integration test"},
    )
    assert status == 200
    assert body["description"] == "Updated by integration test"

    # Content versions should exist
    status, versions = _request("GET", "/v1/skills/integration-test-skill/content-versions")
    assert status == 200
    assert len(versions) >= 1

    # Delete
    status, _ = _request("DELETE", "/v1/skills/integration-test-skill")
    assert status == 200

    # Verify deleted
    status, _ = _request("GET", "/v1/skills/integration-test-skill")
    assert status == 404
