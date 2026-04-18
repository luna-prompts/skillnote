"""Integration tests for skill-create/update collection-name validation.

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
def seed_collection():
    name = f"seed-{uuid.uuid4().hex[:8]}"
    _request("POST", "/v1/collections", {"name": name, "description": ""})
    yield name
    _request("DELETE", f"/v1/collections/{name}")


@pytest.fixture
def unique_skill_slug():
    slug = f"test-skill-{uuid.uuid4().hex[:8]}"
    yield slug
    _request("DELETE", f"/v1/skills/{slug}")  # idempotent — 404 is fine


def _skill_payload(slug: str, collections: list[str]):
    return {
        "name": slug,
        "slug": slug,
        "description": "validation test skill",
        "content_md": "",
        "collections": collections,
    }


def test_create_skill_rejects_invalid_collection_name(seed_collection, unique_skill_slug):
    status, body = _request("POST", "/v1/skills", _skill_payload(unique_skill_slug, ["Bad Name"]))
    assert status == 422
    assert body["error"]["code"] == "COLLECTION_NAME_INVALID"


def test_create_skill_accepts_canonicalizable_variant(seed_collection, unique_skill_slug):
    # Send uppercase variant; canonicalize should map it to the seeded lowercase form
    status, body = _request("POST", "/v1/skills", _skill_payload(unique_skill_slug, [seed_collection.upper()]))
    assert status == 201, body
    assert body["collections"] == [seed_collection]


def test_update_skill_rejects_invalid_collection_name(seed_collection, unique_skill_slug):
    status, _ = _request("POST", "/v1/skills", _skill_payload(unique_skill_slug, [seed_collection]))
    assert status == 201
    status, body = _request(
        "PATCH", f"/v1/skills/{unique_skill_slug}", {"collections": ["Bad Name"]}
    )
    assert status == 422
    assert body["error"]["code"] == "COLLECTION_NAME_INVALID"
