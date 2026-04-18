import json, os, urllib.request, urllib.error, pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _req(method, path, body=None):
    req = urllib.request.Request(
        f"{BASE_URL}{path}", method=method,
        headers={"Content-Type": "application/json"} if body else {},
        data=(json.dumps(body).encode() if body else None),
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


def test_refresh_nonexistent_source():
    status, body = _req("POST", "/v1/import/sources/00000000-0000-0000-0000-000000000000/refresh",
                        {"mode": "preview"})
    assert status == 404


def test_delete_nonexistent_source():
    status, _ = _req("DELETE", "/v1/import/sources/00000000-0000-0000-0000-000000000000")
    assert status == 404
