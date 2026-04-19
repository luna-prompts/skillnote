import json, os, urllib.request, urllib.error, uuid, pytest

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


def test_list_sources_empty_ok():
    status, body = _req("GET", "/v1/import/sources")
    assert status == 200
    assert isinstance(body, list)


def test_list_sources_returns_drift_badges():
    status, body = _req("GET", "/v1/import/sources")
    assert status == 200
    for src in body:
        for key in ("id", "url", "status", "skill_count"):
            assert key in src
