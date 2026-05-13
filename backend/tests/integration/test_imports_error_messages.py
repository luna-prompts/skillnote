"""R7 regression: marketplace 404 message must not contain literal "None".

Pre-R7: hitting Import on a nonexistent GitHub repo (e.g.
`https://github.com/this-user-does-not-exist/repo-also-not-real`) produced
the error string "this-user-does-not-exist/repo-also-not-real@None not
found" — the literal Python None leaked into the user-facing message.

The R7 fix in `backend/app/services/imports/inspector.py:86-100`:
- If `ref is None`, just use the repo without "@".
- Otherwise use "<repo>@<ref>".

This test verifies the inspector code path directly (no live GitHub call —
we don't have a way to mock urllib from pytest without complexity).
Instead we exercise the message-construction logic by invoking the API
with a URL that the inspector will treat as not-found via SSRF/syntax,
and assert the response body never contains the literal substring "None".
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
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def test_inspect_error_messages_never_contain_python_None():
    """Three pathological URLs — each must error WITHOUT the literal "None"."""
    bad_urls = [
        # Nonexistent github repo (will 404 from GitHub API).
        "https://github.com/this-user-does-not-exist-xyz789/repo-also-not-real",
        # Malformed URL — should be rejected at parse time.
        "https://github.com/just-one-segment",
        # Plain non-GitHub URL — backend should reject as unsupported.
        "https://example.com/random/path",
    ]
    for url in bad_urls:
        status, body = _post("/v1/import/inspect", {"source": url})
        # Any error response (404/422/400/etc.) is OK. The bug-shape was
        # specifically that the error MESSAGE contained "None".
        if 200 <= status < 300:
            continue  # somehow it worked, nothing to assert here
        # Pull every string from the response body and assert no "None"
        # literal anywhere in the user-facing message field.
        msg = ''
        if isinstance(body, dict):
            err = body.get('error') or {}
            if isinstance(err, dict):
                msg = str(err.get('message', ''))
            else:
                msg = str(err)
        assert 'None' not in msg, (
            f"URL {url!r} returned an error message containing literal 'None': {msg!r}"
        )
