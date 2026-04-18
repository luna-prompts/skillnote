"""Adversarial-inputs smoke tests for the marketplace-import API.

Probes the edges a real attacker (or confused user) would hit and verifies the
API responds sensibly:
    - 4xx status codes (never 500 for user input)
    - Standard error envelope: {"error": {"code": ..., "message": ...}}
    - Correct error code per case

Runs in-process via fastapi.testclient.TestClient — no live API / network.

Categories:
    1. Scheme/URL attacks           (file://, javascript:, ftp://, ...)
    2. Private-IP / SSRF gates      (localhost, 10.x, metadata, IPv6, SSH-form)
    3. Input parsing edge cases     (no slash, control chars, huge string, ...)
    4. Unsupported source types     (local paths reach inspector stub)
    5. Pydantic body validation     (missing fields, wrong types, Literal, ...)
    6. Content-type edge cases      (invalid JSON, no header, oversize)
    7. Upstream error mapping       (404 -> REPO_NOT_FOUND, 403 -> REPO_PRIVATE)
"""
from __future__ import annotations

import json
import os
from typing import Iterable

import pytest
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app, raise_server_exceptions=False)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _post(path: str, body) -> tuple[int, dict]:
    """POST JSON, return (status, parsed_body). Body may be any JSON-encodable value."""
    r = client.post(path, json=body)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, {"_raw": r.text}


def _assert_error_envelope(status: int, body: dict, allowed_codes: Iterable[str], label: str) -> None:
    """Every 4xx/5xx response must use the standard envelope with a sensible code."""
    assert status != 500, f"{label}: unexpected 500 (production bug) — body={body!r}"
    assert "error" in body, f"{label}: missing error envelope — body={body!r}"
    assert "code" in body["error"], f"{label}: missing error.code — body={body!r}"
    assert "message" in body["error"], f"{label}: missing error.message — body={body!r}"
    assert body["error"]["code"] in allowed_codes, (
        f"{label}: got code={body['error']['code']!r}, expected one of {list(allowed_codes)} — body={body!r}"
    )


# --------------------------------------------------------------------------- #
# 1. Scheme / URL attacks
# --------------------------------------------------------------------------- #
# All of these should be rejected before hitting any upstream service.
# Some are rejected at parse time (file://, javascript:, ftp://, ... — not
# matching the HTTPS/SSH/shorthand grammar so parse_input returns None).
# Others pass parsing as source_type="url" and then fail the security gate.

_SCHEME_CASES = [
    # (input, allowed error codes)
    ("file:///etc/passwd",        ("INPUT_UNPARSEABLE", "URL_SCHEME_FORBIDDEN")),
    ("javascript:alert(1)",       ("INPUT_UNPARSEABLE", "URL_SCHEME_FORBIDDEN")),
    ("ftp://example.com/",        ("INPUT_UNPARSEABLE", "URL_SCHEME_FORBIDDEN")),
    ("mailto:x@y.com",            ("INPUT_UNPARSEABLE", "URL_SCHEME_FORBIDDEN")),
    ("data:text/plain;base64,xxx",("INPUT_UNPARSEABLE", "URL_SCHEME_FORBIDDEN")),
    ("gopher://evil.example.com/",("INPUT_UNPARSEABLE", "URL_SCHEME_FORBIDDEN")),
    # Scheme-with-empty-host variants — parser rejects as "no host"
    ("https://",                  ("INPUT_UNPARSEABLE",)),
    ("https:///",                 ("INPUT_UNPARSEABLE",)),
]


@pytest.mark.parametrize("inp,allowed", _SCHEME_CASES,
                         ids=[c[0] for c in _SCHEME_CASES])
def test_inspect_rejects_dangerous_schemes(inp, allowed):
    status, body = _post("/v1/import/inspect", {"input": inp})
    assert status == 400, f"{inp!r}: expected 400, got {status} — {body!r}"
    _assert_error_envelope(status, body, allowed, inp)


# --------------------------------------------------------------------------- #
# 2. Private-IP / SSRF gates
# --------------------------------------------------------------------------- #
# URLs with allowed schemes but private/reserved hosts must be rejected by the
# security module with URL_SCHEME_FORBIDDEN before any outbound request.

_SSRF_CASES = [
    "http://localhost:8082/x",                       # localhost literal
    "https://127.0.0.1/x",                           # IPv4 loopback
    "http://10.0.0.1/x",                             # RFC1918 private
    "http://169.254.169.254/latest/meta-data/",      # AWS metadata (link-local)
    "http://100.64.0.1/x",                           # CGNAT
    "http://[::1]/x",                                # IPv6 loopback
    "git@10.0.0.1:someone/x.git",                    # SSH-form to private IP
]


@pytest.mark.parametrize("inp", _SSRF_CASES, ids=_SSRF_CASES)
def test_inspect_ssrf_gates_block_private_hosts(inp):
    status, body = _post("/v1/import/inspect", {"input": inp})
    assert status == 400, f"{inp!r}: expected 400, got {status} — {body!r}"
    _assert_error_envelope(status, body, ("URL_SCHEME_FORBIDDEN",), inp)


# --------------------------------------------------------------------------- #
# 3. Input parsing edge cases
# --------------------------------------------------------------------------- #

_PARSE_CASES = [
    ("owner",                               ("INPUT_UNPARSEABLE",)),       # no slash
    ("owner/",                              ("INPUT_UNPARSEABLE",)),       # empty right
    ("/repo",                               ("INPUT_UNPARSEABLE",)),       # empty left / abs w/o dir
    ("owner/repo:weird",                    ("INPUT_UNPARSEABLE",)),       # colon breaks shorthand
    ("owner/repo with spaces",              ("INPUT_UNPARSEABLE",)),       # whitespace rejected
    ("owner/repo\nembedded",                ("INPUT_UNPARSEABLE",)),       # control char
    ("a" * 5000,                            ("INPUT_UNPARSEABLE",)),       # huge string
    ("owner/repo@../../../../etc/passwd",   ("INPUT_UNPARSEABLE",)),       # path traversal in ref
]


@pytest.mark.parametrize("inp,allowed", _PARSE_CASES,
                         ids=[f"case-{i}" for i in range(len(_PARSE_CASES))])
def test_inspect_rejects_unparseable_inputs(inp, allowed):
    status, body = _post("/v1/import/inspect", {"input": inp})
    assert status == 400, f"{inp[:40]!r}: expected 400, got {status} — {body!r}"
    _assert_error_envelope(status, body, allowed, inp[:40])


# --------------------------------------------------------------------------- #
# 4. Valid-but-unsupported source types
# --------------------------------------------------------------------------- #
# Local directory/file paths parse successfully but the v1 inspector only
# handles github/ URL kinds — so they reach the inspector and come back with
# UNSUPPORTED_SOURCE_TYPE.

_UNSUPPORTED_CASES = [
    ("./local/path",                ("UNSUPPORTED_SOURCE_TYPE", "INPUT_UNPARSEABLE")),
    ("/absolute/path/file.json",    ("UNSUPPORTED_SOURCE_TYPE", "INPUT_UNPARSEABLE")),
]


@pytest.mark.parametrize("inp,allowed", _UNSUPPORTED_CASES,
                         ids=[c[0] for c in _UNSUPPORTED_CASES])
def test_inspect_rejects_unsupported_source_types(inp, allowed):
    status, body = _post("/v1/import/inspect", {"input": inp})
    assert status == 400, f"{inp!r}: expected 400, got {status} — {body!r}"
    _assert_error_envelope(status, body, allowed, inp)


# --------------------------------------------------------------------------- #
# 5. Pydantic body validation
# --------------------------------------------------------------------------- #
# The validation envelope is normalized to VALIDATION_ERROR by the app's
# RequestValidationError handler in app/main.py.


@pytest.mark.parametrize("path,body", [
    ("/v1/import/inspect", {}),                          # missing input
    ("/v1/import/inspect", {"input": ""}),               # min_length=1
    ("/v1/import/inspect", {"input": 123}),              # wrong type
    ("/v1/import/inspect", {"input": None}),             # null
    ("/v1/import/inspect", {"input": []}),               # list not string
    ("/v1/import/inspect", {"input": {"a": 1}}),         # dict not string
    ("/v1/import/apply", {}),                            # missing input
    ("/v1/import/apply", {"input": ""}),                 # min_length=1
    ("/v1/import/apply", {"input": "owner/repo", "on_conflict": "mayhem"}),  # Literal
    ("/v1/import/apply", {"input": "owner/repo", "on_conflict": 42}),        # Literal wrong type
    ("/v1/import/apply", {"input": "owner/repo", "skill_selection": "not-a-list"}),  # list type
])
def test_body_validation_returns_validation_error(path, body):
    status, resp = _post(path, body)
    assert status == 422, f"{path} {body!r}: expected 422, got {status} — {resp!r}"
    _assert_error_envelope(status, resp, ("VALIDATION_ERROR",), f"{path} {body!r}")


# --------------------------------------------------------------------------- #
# 5b. target_collection_slug validation (runtime, via importer)
# --------------------------------------------------------------------------- #
# target_collection_slug is not constrained at the schema level — validation
# happens inside apply_import via validate_collection_name. These cases need
# a mock upstream since they must first pass inspect().

_SLUG_CASES = [
    ("Bad Name",              "COLLECTION_NAME_INVALID"),  # spaces + caps
    ("anthropic-reserved",    "COLLECTION_NAME_INVALID"),  # reserved word
    ("claude-something",      "COLLECTION_NAME_INVALID"),  # reserved word
    ("   ",                   "COLLECTION_NAME_INVALID"),  # whitespace-only
    ("has/slash",             "COLLECTION_NAME_INVALID"),  # forbidden char
    ("ALLCAPS",               "COLLECTION_NAME_INVALID"),  # uppercase
    ("with spaces inside",    "COLLECTION_NAME_INVALID"),
    ("x" * 200,               "COLLECTION_NAME_INVALID"),  # > 128 chars
]


@pytest.fixture(scope="module")
def mock_github_server():
    """Module-scoped MockServer shared by all slug tests — keeps runtime under
    the 5s budget (a fresh Flask server per test costs ~0.5s each)."""
    from tests.fixtures.mock_git_server import MockServer
    srv = MockServer()
    srv.start()
    try:
        srv.serve_repo("foo/bar", ref="main", sha="deadbeef")
        srv.serve_repo("foo/baradv", ref="main", sha="feedface")
        srv.serve_repo("ghost/repo", ref="main", sha="x")
        srv.serve_repo("private/repo", ref="main", sha="x")
        yield srv
    finally:
        srv.stop()


@pytest.mark.parametrize("slug,expected_code", _SLUG_CASES,
                         ids=[c[0][:20] for c in _SLUG_CASES])
def test_apply_rejects_invalid_collection_slug(slug, expected_code, monkeypatch, mock_github_server):
    """Bad slugs are caught inside apply_import() after inspect() succeeds."""
    mock_github_server.set_failure_mode(None)
    monkeypatch.setenv("SKILLNOTE_IMPORT_GITHUB_API_BASE", mock_github_server.api_base)
    r = client.post("/v1/import/apply", json={
        "input": "foo/bar",
        "target_collection_slug": slug,
    })
    status = r.status_code
    body = r.json()
    assert status == 422, f"slug={slug!r}: expected 422, got {status} — {body!r}"
    _assert_error_envelope(status, body, (expected_code,), slug)


def test_apply_empty_slug_falls_back_to_default(monkeypatch, mock_github_server):
    """Documented behavior: empty target_collection_slug falls back to
    `{owner}-{repo}`. This is NOT a bug — it's an intentional convenience when
    clients omit the slug (sending '' instead of null). Pinning this behavior
    so future refactors don't accidentally tighten it."""
    from app.db.session import SessionLocal
    from app.db.models import ImportSource, Collection, Skill
    mock_github_server.set_failure_mode(None)
    monkeypatch.setenv("SKILLNOTE_IMPORT_GITHUB_API_BASE", mock_github_server.api_base)
    r = client.post("/v1/import/apply", json={
        "input": "foo/baradv",
        "target_collection_slug": "",
    })
    try:
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["collection_slug"] == "foo-baradv"
    finally:
        try:
            body = r.json()
            src_id = body.get("source_id")
            slug = body.get("collection_slug")
            with SessionLocal() as db:
                if src_id:
                    db.query(Skill).filter(Skill.import_source_id == src_id).delete()
                    db.query(ImportSource).filter(ImportSource.id == src_id).delete()
                if slug:
                    db.query(Collection).filter(Collection.name == slug).delete()
                db.commit()
        except Exception:
            pass


# --------------------------------------------------------------------------- #
# 6. Content-type / body edge cases
# --------------------------------------------------------------------------- #


def test_invalid_json_body_returns_validation_error():
    r = client.post(
        "/v1/import/inspect",
        content="not-json-at-all{{{",
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 422, r.text
    body = r.json()
    _assert_error_envelope(r.status_code, body, ("VALIDATION_ERROR",), "invalid-json")


def test_missing_content_type_header_still_validates():
    """FastAPI + starlette's default parsing accepts raw JSON bytes even
    without a Content-Type header; the body must still validate structurally
    or return a 422 VALIDATION_ERROR. Must never 500."""
    r = client.post(
        "/v1/import/inspect",
        content=b'{"input": "owner/repo"}',
    )
    # Either 200-ish (parse succeeds and inspect runs — unlikely without mock)
    # or a 4xx. Must NOT be 500.
    assert r.status_code != 500, r.text
    assert r.status_code in (200, 400, 401, 404, 415, 422, 429, 504), r.text


def test_empty_body_returns_validation_error():
    r = client.post("/v1/import/inspect", content=b"", headers={"Content-Type": "application/json"})
    assert r.status_code == 422, r.text
    body = r.json()
    _assert_error_envelope(r.status_code, body, ("VALIDATION_ERROR",), "empty-body")


def test_array_instead_of_object_returns_validation_error():
    r = client.post(
        "/v1/import/inspect",
        content=b'[1, 2, 3]',
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 422, r.text
    body = r.json()
    _assert_error_envelope(r.status_code, body, ("VALIDATION_ERROR",), "json-array")


def test_oversized_body_is_rejected_sanely():
    """A ~10MB JSON body should produce a 4xx (no 500, no hang)."""
    big_input = "a" * 10_000_000  # 10MB
    body = json.dumps({"input": big_input})
    r = client.post(
        "/v1/import/inspect",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    # 10MB does NOT match any valid source grammar, so we expect 400 INPUT_UNPARSEABLE.
    # (There's no explicit request-size limit in the app, but the parser catches it.)
    assert r.status_code in (400, 413, 422), r.text
    assert r.status_code != 500, r.text
    resp = r.json()
    assert "error" in resp, resp


# --------------------------------------------------------------------------- #
# 7. Upstream error mapping (via MockServer)
# --------------------------------------------------------------------------- #


def test_inspect_maps_upstream_404_to_repo_not_found(monkeypatch, mock_github_server):
    mock_github_server.set_failure_mode("404")
    monkeypatch.setenv("SKILLNOTE_IMPORT_GITHUB_API_BASE", mock_github_server.api_base)
    try:
        r = client.post("/v1/import/inspect", json={"input": "ghost/repo"})
    finally:
        mock_github_server.set_failure_mode(None)
    assert r.status_code == 404, r.text
    _assert_error_envelope(r.status_code, r.json(), ("REPO_NOT_FOUND",), "upstream-404")


def test_inspect_maps_upstream_403_to_repo_private(monkeypatch, mock_github_server):
    mock_github_server.set_failure_mode("403")
    monkeypatch.setenv("SKILLNOTE_IMPORT_GITHUB_API_BASE", mock_github_server.api_base)
    try:
        r = client.post("/v1/import/inspect", json={"input": "private/repo"})
    finally:
        mock_github_server.set_failure_mode(None)
    assert r.status_code == 401, r.text
    _assert_error_envelope(r.status_code, r.json(), ("REPO_PRIVATE",), "upstream-403")


def test_inspect_maps_upstream_unreachable_to_upstream_timeout(monkeypatch):
    """Point the inspector at a closed port; parse_input/security pass,
    inspector fails with UPSTREAM_TIMEOUT → HTTP 504."""
    monkeypatch.setenv("SKILLNOTE_IMPORT_GITHUB_API_BASE", "http://127.0.0.1:1")
    r = client.post("/v1/import/inspect", json={"input": "some/repo"})
    assert r.status_code == 504, r.text
    _assert_error_envelope(r.status_code, r.json(), ("UPSTREAM_TIMEOUT",), "unreachable")


def test_inspect_rate_limited_via_monkeypatched_service(monkeypatch):
    """MockServer has no 429 mode. Instead, monkeypatch inspect_source to
    return a RATE_LIMITED InspectResult and verify the route maps to 429."""
    from app.api import imports as imports_module
    from app.services.imports.inspector import InspectResult

    def _fake_inspect(parsed, *, token=None, timeout_s=30):
        return InspectResult(error_code="RATE_LIMITED",
                             error_message="GitHub rate limit exceeded")

    monkeypatch.setattr(imports_module, "inspect_source", _fake_inspect)
    r = client.post("/v1/import/inspect", json={"input": "owner/repo"})
    assert r.status_code == 429, r.text
    _assert_error_envelope(r.status_code, r.json(), ("RATE_LIMITED",), "rate-limited")


# --------------------------------------------------------------------------- #
# 8. Apply endpoint — adversarial inputs (same scheme/ssrf/parse matrix)
# --------------------------------------------------------------------------- #
# Cheap smoke-test that /v1/import/apply rejects bad inputs with the same
# codes as /inspect (it uses the same parse_input + validate_import_url path).


_APPLY_REJECT_CASES = [
    # (input, expected_status, allowed codes)
    ("file:///etc/passwd",        400, ("INPUT_UNPARSEABLE",)),
    ("javascript:alert(1)",       400, ("INPUT_UNPARSEABLE",)),
    ("http://localhost:8082/x",   400, ("URL_SCHEME_FORBIDDEN",)),
    ("http://10.0.0.1/x",         400, ("URL_SCHEME_FORBIDDEN",)),
    ("owner",                     400, ("INPUT_UNPARSEABLE",)),
    ("owner/repo:bad",            400, ("INPUT_UNPARSEABLE",)),
    ("https://",                  400, ("INPUT_UNPARSEABLE",)),
]


@pytest.mark.parametrize("inp,expected_status,allowed", _APPLY_REJECT_CASES,
                         ids=[c[0] for c in _APPLY_REJECT_CASES])
def test_apply_rejects_same_cases_as_inspect(inp, expected_status, allowed):
    status, body = _post("/v1/import/apply", {"input": inp})
    assert status == expected_status, f"{inp!r}: expected {expected_status}, got {status} — {body!r}"
    _assert_error_envelope(status, body, allowed, inp)
