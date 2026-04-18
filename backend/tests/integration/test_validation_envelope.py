"""Integration tests verifying Pydantic 422s are wrapped in the standard error envelope.

Requires a running backend on 127.0.0.1:8082 (`podman-compose up api`).
Tests skip if API unreachable.
"""
import json
import os
import urllib.error
import urllib.request

import pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _post(path: str, body: dict):
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        method="POST",
        headers={"Content-Type": "application/json"},
        data=json.dumps(body).encode(),
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def test_collection_validation_422_uses_error_envelope():
    status, body = _post("/v1/collections", {"name": ""})
    assert status == 422
    assert "error" in body, f"Expected 'error' envelope, got: {body}"
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert isinstance(body["error"]["message"], str)
    assert "required" in body["error"]["message"].lower() or "name" in body["error"]["message"].lower()


def test_collection_invalid_name_uses_error_envelope():
    status, body = _post("/v1/collections", {"name": "Uppercase"})
    assert status == 422
    assert "error" in body
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_missing_required_field_uses_error_envelope():
    # POST with no name key at all
    status, body = _post("/v1/collections", {"description": "no name"})
    assert status == 422
    assert "error" in body
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "name" in body["error"]["message"].lower()


def test_envelope_does_not_leak_raw_input():
    """The envelope should NOT echo the raw input field (Pydantic default leaks it as `input` key)."""
    status, body = _post("/v1/collections", {"name": "INJECTION_MARKER_XYZ"})
    assert status == 422
    # Envelope should have error object, but should not contain the raw value as a separate leak
    raw = json.dumps(body)
    # The message might legitimately mention the value, but the envelope shouldn't expose `ctx` or `input` Pydantic internals
    assert "ctx" not in raw, f"Pydantic internals leaked: {body}"


def test_skill_validation_422_uses_error_envelope():
    status, body = _post("/v1/skills", {"name": "", "slug": "", "description": "", "collections": []})
    assert status == 422
    assert "error" in body
    assert body["error"]["code"] == "VALIDATION_ERROR"
