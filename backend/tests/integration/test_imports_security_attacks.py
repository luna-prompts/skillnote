"""Adversarial security scenarios against /v1/import/*.

Targets the LIVE API (default http://127.0.0.1:8082, override with
SKILLNOTE_TEST_BASE_URL). Complementary to the in-process TestClient suite in
tests/integration/test_import_inputs_adversarial.py — this one pins the
black-box behavior of the deployed endpoint against a fixed matrix of
attacker-controlled payloads.

Each case asserts the exact (status, error.code) pair the API returns today.
Plan predicted URL_SCHEME_FORBIDDEN for some non-http schemes (file://,
javascript:, ftp://, data:), but the implementation rejects them earlier at
input_parser time (they don't match any grammar), so the real response is
INPUT_UNPARSEABLE. Empty string "" trips the pydantic min_length=1 validator
before reaching the parser, so the real response is 422 VALIDATION_ERROR.
Matrix adjusted to reflect those truths.
"""
import json
import os
import urllib.error
import urllib.request

import pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _inspect(input_str):
    req = urllib.request.Request(
        f"{BASE_URL}/v1/import/inspect",
        method="POST",
        headers={"Content-Type": "application/json"},
        data=json.dumps({"input": input_str}).encode(),
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())
    except Exception as e:
        pytest.skip(f"API not reachable at {BASE_URL}: {e}")


# Matrix of adversarial inputs with their expected (status, error.code).
#
# Adjustments from the original spec, confirmed by probing the live API:
#   - file://, javascript:, ftp://, data: → these fail parse_input (they don't
#     match SSH, HTTP(S), local-path, or owner/repo grammars), so the API
#     returns 400 INPUT_UNPARSEABLE, NOT URL_SCHEME_FORBIDDEN. The scheme
#     allowlist is only reached for URLs that parse as http/https source_type.
#   - "" → Pydantic `Field(..., min_length=1)` catches the empty string before
#     it reaches parse_input, so the API returns 422 VALIDATION_ERROR.
_CASES = [
    # Non-http schemes — rejected at parse time (no grammar match).
    ("file:///etc/passwd",                     400, "INPUT_UNPARSEABLE"),
    ("javascript:alert(1)",                    400, "INPUT_UNPARSEABLE"),
    ("ftp://example.com/foo",                  400, "INPUT_UNPARSEABLE"),
    ("data:text/plain;base64,xxx",             400, "INPUT_UNPARSEABLE"),
    # SSRF / private-IP gates — parse as http/https, blocked by security layer.
    ("http://169.254.169.254/metadata",        400, "URL_SCHEME_FORBIDDEN"),
    ("http://localhost:8082/v1/collections",   400, "URL_SCHEME_FORBIDDEN"),
    ("http://127.0.0.1",                       400, "URL_SCHEME_FORBIDDEN"),
    ("http://10.0.0.1/",                       400, "URL_SCHEME_FORBIDDEN"),
    ("http://192.168.1.1/",                    400, "URL_SCHEME_FORBIDDEN"),
    ("http://172.16.0.1/",                     400, "URL_SCHEME_FORBIDDEN"),
    # Pydantic body validation — empty string fails min_length=1 before parse.
    ("",                                       422, "VALIDATION_ERROR"),
    # Control/metacharacter injection — rejected by parse_input.
    ("owner/repo\nembedded-newline",           400, "INPUT_UNPARSEABLE"),
    ("owner/repo\0nullbyte",                   400, "INPUT_UNPARSEABLE"),
    ("owner/repo; rm -rf /",                   400, "INPUT_UNPARSEABLE"),
    ("owner/repo@../../etc",                   400, "INPUT_UNPARSEABLE"),
]


@pytest.mark.parametrize(
    "payload,expected_status,expected_code",
    _CASES,
    ids=[repr(c[0])[:40] for c in _CASES],
)
def test_adversarial_input_rejected(payload, expected_status, expected_code):
    status, body = _inspect(payload)
    assert status == expected_status, (
        f"{payload!r}: expected HTTP {expected_status}, got {status} — body={body!r}"
    )
    assert "error" in body, f"{payload!r}: missing error envelope — body={body!r}"
    assert body["error"]["code"] == expected_code, (
        f"{payload!r}: expected code={expected_code!r}, "
        f"got {body['error'].get('code')!r} — body={body!r}"
    )
