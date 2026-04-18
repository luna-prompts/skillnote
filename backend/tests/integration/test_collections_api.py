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


def test_delete_empty_collection(unique_name):
    _request("POST", "/v1/collections", {"name": unique_name, "description": ""})

    status, _ = _request("DELETE", f"/v1/collections/{unique_name}")
    assert status == 204

    status, cols = _request("GET", "/v1/collections")
    names = [c["name"] for c in cols]
    assert unique_name not in names


def test_delete_404_when_not_exists():
    status, body = _request("DELETE", "/v1/collections/does-not-exist-xyz")
    assert status == 404


def test_delete_409_when_skills_reference(unique_name):
    """Creating a skill in a collection implicitly registers it — DELETE should refuse."""
    skill_slug = f"test-skill-{uuid.uuid4().hex[:8]}"
    _request("POST", "/v1/skills", {
        "name": skill_slug,
        "slug": skill_slug,
        "description": "test fixture",
        "content_md": "",
        "collections": [unique_name],
    })

    status, body = _request("DELETE", f"/v1/collections/{unique_name}")
    assert status == 409
    assert body["error"]["code"] == "COLLECTION_IN_USE"

    _request("DELETE", f"/v1/skills/{skill_slug}")


# ── Case-insensitive uniqueness ──────────────────────────────────────────────

def test_post_rejects_uppercase_name(unique_name):
    """POST with an uppercase name must fail validation with 422.

    The stricter name rule (`^[a-z0-9_-]+$`) means uppercase variants can no
    longer be created at all; case-insensitive dedup only applies on lookup.
    """
    status, body = _request(
        "POST", "/v1/collections", {"name": unique_name.upper(), "description": ""}
    )
    assert status == 422, f"expected 422, got {status}: {body}"


def test_get_single_collection_case_insensitive(unique_name):
    """GET /v1/collections/{name} must accept case variants."""
    _request("POST", "/v1/collections", {"name": unique_name, "description": "hello"})

    status, body = _request("GET", f"/v1/collections/{unique_name.upper()}")
    assert status == 200
    assert body["name"] == unique_name
    assert body["description"] == "hello"

    _request("DELETE", f"/v1/collections/{unique_name}")


def test_put_via_case_variant_url(unique_name):
    """PUT /v1/collections/{CASE-VARIANT} must update the original."""
    _request("POST", "/v1/collections", {"name": unique_name, "description": "orig"})

    status, body = _request("PUT", f"/v1/collections/{unique_name.upper()}",
                            {"description": "updated"})
    assert status == 200
    assert body["description"] == "updated"

    _request("DELETE", f"/v1/collections/{unique_name}")


def test_delete_via_case_variant_url(unique_name):
    """DELETE /v1/collections/{CASE-VARIANT} must delete the original."""
    _request("POST", "/v1/collections", {"name": unique_name, "description": ""})

    status, _ = _request("DELETE", f"/v1/collections/{unique_name.upper()}")
    assert status == 204

    status, _ = _request("GET", f"/v1/collections/{unique_name}")
    assert status == 404


# ── Skill-collection integration (case-insensitive) ──────────────────────────

def test_skills_collections_normalized_on_save(unique_name):
    """Creating a skill with case-variant collection names canonicalizes them."""
    # First create the collection with a canonical form
    _request("POST", "/v1/collections", {"name": unique_name, "description": ""})

    # Save a skill using a DIFFERENT case variant
    skill_slug = f"norm-test-{uuid.uuid4().hex[:8]}"
    status, skill = _request("POST", "/v1/skills", {
        "name": skill_slug,
        "slug": skill_slug,
        "description": "test",
        "content_md": "# test",
        "collections": [unique_name.upper()],
    })
    assert status == 201
    # API should have canonicalized to the stored form (unique_name, not uppercase)
    assert skill["collections"] == [unique_name], (
        f"expected canonical {[unique_name]}, got {skill['collections']}"
    )

    _request("DELETE", f"/v1/skills/{skill_slug}")
    _request("DELETE", f"/v1/collections/{unique_name}")


def test_get_collections_no_case_duplicates(unique_name):
    """Even if skills have mixed-case collection refs, GET returns one row."""
    _request("POST", "/v1/collections", {"name": unique_name, "description": ""})

    # Save a skill with the uppercase variant — canonicalization should map it
    skill_slug = f"dup-test-{uuid.uuid4().hex[:8]}"
    _request("POST", "/v1/skills", {
        "name": skill_slug,
        "slug": skill_slug,
        "description": "test",
        "content_md": "# test",
        "collections": [unique_name.upper()],
    })

    # GET /v1/collections must list this name exactly once
    status, cols = _request("GET", "/v1/collections")
    assert status == 200
    matches = [c for c in cols if c["name"].lower() == unique_name.lower()]
    assert len(matches) == 1, f"expected 1 row, got {len(matches)}: {matches}"

    _request("DELETE", f"/v1/skills/{skill_slug}")
    _request("DELETE", f"/v1/collections/{unique_name}")


def test_filter_skills_case_insensitive(unique_name):
    """GET /v1/skills?collections=xxx must be case-insensitive."""
    _request("POST", "/v1/collections", {"name": unique_name, "description": ""})

    skill_slug = f"filt-test-{uuid.uuid4().hex[:8]}"
    _request("POST", "/v1/skills", {
        "name": skill_slug,
        "slug": skill_slug,
        "description": "test",
        "content_md": "# test",
        "collections": [unique_name],
    })

    # Filter by lowercase variant — should still find the skill
    status, skills = _request("GET", f"/v1/skills?collections={unique_name.lower()}")
    assert status == 200
    slugs = [s["slug"] for s in skills]
    assert skill_slug in slugs

    # Uppercase variant — also finds it
    status, skills = _request("GET", f"/v1/skills?collections={unique_name.upper()}")
    assert status == 200
    slugs = [s["slug"] for s in skills]
    assert skill_slug in slugs

    _request("DELETE", f"/v1/skills/{skill_slug}")
    _request("DELETE", f"/v1/collections/{unique_name}")


def test_get_single_collection_not_found():
    status, body = _request("GET", "/v1/collections/does-not-exist-xyz-12345")
    assert status == 404
    assert body["error"]["code"] == "COLLECTION_NOT_FOUND"
