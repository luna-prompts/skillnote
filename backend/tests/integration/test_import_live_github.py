"""Live GitHub smoke tests for /v1/import/inspect.

Opt-in via SKILLNOTE_LIVE_GITHUB_TESTS=1. Without that env var, every test in
this module skips — we don't want GitHub's network flakiness or rate limits
leaking into regular CI.

These tests intentionally skip the MockServer and hit real api.github.com, to
verify our inspector + input parser actually handle the shape of the live API.

Budget: ~6 requests per full run, well under the unauthenticated 60/hour limit.

Run:
    cd backend && SKILLNOTE_LIVE_GITHUB_TESTS=1 \
        ./.venv/bin/pytest tests/integration/test_import_live_github.py -v
"""
from __future__ import annotations

import os
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app


pytestmark = pytest.mark.skipif(
    os.environ.get("SKILLNOTE_LIVE_GITHUB_TESTS") != "1",
    reason="Set SKILLNOTE_LIVE_GITHUB_TESTS=1 to run live GitHub tests",
)


# octocat/Hello-World is GitHub's own test fixture, documented in their REST
# API docs, and has existed since 2011. It's the safest long-lived target.
LIVE_OWNER = "octocat"
LIVE_REPO = "Hello-World"
LIVE_SHORTHAND = f"{LIVE_OWNER}/{LIVE_REPO}"


@pytest.mark.xfail(
    strict=True,
    reason=(
        "BUG: inspector hardcodes ref='main' when parsed.get('ref') is None, "
        "but octocat/Hello-World's default branch is 'master'. GitHub API "
        "returns 422 ('No commit found for SHA: main'), which the inspector "
        "maps to UPSTREAM_TIMEOUT. Expected: default to None and let the "
        "GitHub API resolve HEAD, or query /repos/{owner}/{repo} first for "
        "default_branch. See inspector.py:59."
    ),
)
def test_live_octocat_hello_world():
    """Happy-path: bare owner/repo shorthand should resolve HEAD."""
    client = TestClient(app)
    r = client.post("/v1/import/inspect", json={"input": LIVE_SHORTHAND})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"]["source_type"] == "github"
    assert body["source"]["owner"] == LIVE_OWNER
    assert body["source"]["repo"] == LIVE_REPO
    sha = body["source"]["resolved_sha"]
    assert sha is not None
    assert len(sha) == 40
    assert all(c in "0123456789abcdef" for c in sha)
    assert body["kind"] in ("marketplace", "plugin", "skill_bundle", "single_skill")
    assert body["suggested_collection_slug"] == "octocat-hello-world"


def test_live_nonexistent_repo_404():
    """A repo that definitely doesn't exist should return 404/REPO_NOT_FOUND."""
    client = TestClient(app)
    bogus = f"skillnote-test-never-exists/repo-{uuid.uuid4().hex}"
    r = client.post("/v1/import/inspect", json={"input": bogus})
    assert r.status_code == 404, r.text
    body = r.json()
    assert body["error"]["code"] == "REPO_NOT_FOUND"


def test_live_ref_by_sha():
    """Passing an explicit 40-char SHA as the ref should round-trip."""
    client = TestClient(app)
    # First resolve the current HEAD via master (since default-branch isn't main).
    r1 = client.post(
        "/v1/import/inspect", json={"input": f"{LIVE_SHORTHAND}@master"}
    )
    assert r1.status_code == 200, r1.text
    sha = r1.json()["source"]["resolved_sha"]
    assert sha and len(sha) == 40

    # Now inspect that specific SHA.
    r2 = client.post(
        "/v1/import/inspect", json={"input": f"{LIVE_SHORTHAND}@{sha}"}
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["source"]["resolved_sha"] == sha


def test_live_ref_by_branch_name():
    """Hello-World's default branch is 'master' (not 'main') — old repo."""
    client = TestClient(app)
    r = client.post(
        "/v1/import/inspect", json={"input": f"{LIVE_SHORTHAND}@master"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"]["ref"] == "master"
    assert body["source"]["resolved_sha"] is not None


@pytest.mark.xfail(
    strict=True,
    reason=(
        "BUG: a plain GitHub HTTPS URL like https://github.com/owner/repo is "
        "parsed with source_type='git' (see input_parser.py:82-88), but the "
        "inspector only handles source_type='github' and rejects all others "
        "with UNSUPPORTED_SOURCE_TYPE (inspector.py:52-55). Real users will "
        "paste github.com URLs constantly and hit a 400 with no actionable "
        "message. Fix: special-case GitHub URLs in the inspector to reuse "
        "the github shorthand path."
    ),
)
def test_live_https_github_url_normalized():
    """Pasting a plain https://github.com/... URL should Just Work."""
    client = TestClient(app)
    r = client.post(
        "/v1/import/inspect",
        json={"input": f"https://github.com/{LIVE_SHORTHAND}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"]["owner"] == LIVE_OWNER
    assert body["source"]["repo"] == LIVE_REPO


def test_live_large_repo_still_responds():
    """A realistically-sized public repo should inspect in well under 10s."""
    client = TestClient(app)
    t0 = time.time()
    r = client.post(
        "/v1/import/inspect",
        json={"input": "anthropics/anthropic-sdk-python@main"},
    )
    elapsed = time.time() - t0
    assert r.status_code == 200, r.text
    assert elapsed < 10, f"inspect took {elapsed:.1f}s (>=10s)"
    body = r.json()
    assert body["source"]["resolved_sha"] is not None
    assert len(body["source"]["resolved_sha"]) == 40
