"""Integration tests for /v1/collections CRUD.

Requires a running backend on 127.0.0.1:8082 (`docker compose up api`).
Tests skip if API unreachable.
"""
import json
import os
import urllib.error
import urllib.request
import uuid

import pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _request(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        method=method,
        headers={"Content-Type": "application/json"} if body else {},
        data=(json.dumps(body).encode() if body is not None else None),
    )
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode()
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        return e.code, json.loads(text) if text else None
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


@pytest.fixture
def unique_name():
    return f"test-col-{uuid.uuid4().hex[:8]}"


def test_create_empty_collection_appears_in_list(unique_name):
    status, _ = _request("POST", "/v1/collections", {"name": unique_name, "description": "desc"})
    assert status == 201

    status, cols = _request("GET", "/v1/collections")
    assert status == 200
    names = [c["name"] for c in cols]
    assert unique_name in names

    match = next(c for c in cols if c["name"] == unique_name)
    assert match["count"] == 0
    assert match["description"] == "desc"

    _request("DELETE", f"/v1/collections/{unique_name}")


def test_list_shape_includes_description_field():
    status, cols = _request("GET", "/v1/collections")
    assert status == 200
    if cols:
        assert "description" in cols[0]
        assert "name" in cols[0]
        assert "count" in cols[0]


def test_post_creates_collection(unique_name):
    status, body = _request("POST", "/v1/collections", {"name": unique_name, "description": ""})
    assert status == 201
    assert body["name"] == unique_name

    _request("DELETE", f"/v1/collections/{unique_name}")


def test_post_duplicate_returns_409(unique_name):
    _request("POST", "/v1/collections", {"name": unique_name, "description": ""})
    status, body = _request("POST", "/v1/collections", {"name": unique_name, "description": ""})
    assert status == 409
    assert body["error"]["code"] == "COLLECTION_EXISTS"

    _request("DELETE", f"/v1/collections/{unique_name}")


def test_post_rejects_empty_name():
    status, _ = _request("POST", "/v1/collections", {"name": "", "description": ""})
    assert status == 422


def test_post_trims_whitespace(unique_name):
    padded = f"  {unique_name}  "
    status, body = _request("POST", "/v1/collections", {"name": padded, "description": ""})
    assert status == 201
    assert body["name"] == unique_name

    _request("DELETE", f"/v1/collections/{unique_name}")


def test_put_updates_description(unique_name):
    _request("POST", "/v1/collections", {"name": unique_name, "description": "original"})

    status, body = _request("PUT", f"/v1/collections/{unique_name}", {"description": "updated"})
    assert status == 200
    assert body["description"] == "updated"

    status, cols = _request("GET", "/v1/collections")
    match = next(c for c in cols if c["name"] == unique_name)
    assert match["description"] == "updated"

    _request("DELETE", f"/v1/collections/{unique_name}")


def test_put_returns_404_when_not_exists():
    status, body = _request("PUT", "/v1/collections/does-not-exist-xyz", {"description": "x"})
    assert status == 404
    assert body["error"]["code"] == "COLLECTION_NOT_FOUND"
