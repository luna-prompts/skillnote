import json
import urllib.error
import urllib.request

import pytest

BASE_URL = "http://127.0.0.1:8080"
TOKEN = "skn_dev_demo_token"


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


def test_validate_token_success_and_failure():
    status, body = _request("POST", "/auth/validate-token", {"Content-Type": "application/json"}, {"token": TOKEN})
    assert status == 200
    assert body["valid"] is True

    status, body = _request("POST", "/auth/validate-token", {"Content-Type": "application/json"}, {"token": "bad"})
    assert status == 200
    assert body["valid"] is False


def test_skills_requires_auth_error_shape():
    status, body = _request("GET", "/v1/skills")
    assert status == 401
    assert "error" in body
    assert "code" in body["error"] and "message" in body["error"]


def test_list_skills_and_versions_with_auth():
    headers = {"Authorization": f"Bearer {TOKEN}"}

    status, skills = _request("GET", "/v1/skills", headers=headers)
    assert status == 200
    assert isinstance(skills, list)
    assert len(skills) >= 1

    status, versions = _request("GET", "/v1/skills/secure-migrations/versions", headers=headers)
    assert status == 200
    assert isinstance(versions, list)
    assert len(versions) >= 1
