"""Integration tests for POST /v1/import/inspect."""
import json
import os
import urllib.error
import urllib.request

import pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _post(path, body):
    req = urllib.request.Request(
        f"{BASE_URL}{path}", method="POST",
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


def test_inspect_github_shorthand_success(monkeypatch):
    """Hit the MockServer so we're not hostage to GitHub's network."""
    from tests.fixtures.mock_git_server import MockServer
    # Stub clone_and_scan so the inspector doesn't attempt a real `git clone`
    # of github.com/wshobson/agents during the HEAD-SHA probe's follow-up step.
    from app.services.imports import cloner as cloner_mod

    def _stub_clone(parsed, **kwargs):
        return cloner_mod.CloneResult(skills=[], resolved_sha="abc1234")

    monkeypatch.setattr(cloner_mod, "clone_and_scan", _stub_clone)

    with MockServer() as srv:
        srv.serve_repo("wshobson/agents", ref="main", sha="abc1234")
        monkeypatch.setenv("SKILLNOTE_IMPORT_GITHUB_API_BASE", srv.api_base)
        from app.main import app
        from fastapi.testclient import TestClient
        client = TestClient(app)
        r = client.post("/v1/import/inspect", json={"input": "wshobson/agents"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["source"]["resolved_sha"] == "abc1234"
        assert body["suggested_collection_slug"] == "wshobson-agents"


def test_inspect_invalid_input():
    status, body = _post("/v1/import/inspect", {"input": "file:///etc/passwd"})
    assert status == 400
    assert body["error"]["code"] in ("URL_SCHEME_FORBIDDEN", "INPUT_UNPARSEABLE")


def test_inspect_nonexistent_repo():
    status, body = _post("/v1/import/inspect",
                          {"input": "skillnote-test/definitely-does-not-exist-12345"})
    assert status == 404
    assert body["error"]["code"] == "REPO_NOT_FOUND"


def test_inspect_missing_input_field():
    status, body = _post("/v1/import/inspect", {})
    assert status == 422
    assert body["error"]["code"] == "VALIDATION_ERROR"
