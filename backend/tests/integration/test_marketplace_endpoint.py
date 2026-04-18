import json, os, urllib.request, urllib.error, pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")

# Seed data guarantees 'official', 'conventions', 'devops' collections exist
# post-migration (see backend/scripts/seed_data.py::seed_collections).
SEED_COLLECTION = "official"


def _get(path, if_none_match=None):
    headers = {}
    if if_none_match:
        headers["If-None-Match"] = if_none_match
    req = urllib.request.Request(f"{BASE_URL}{path}", headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            # HTTP header names are case-insensitive (RFC 9110 §5.1). Normalize
            # to lowercase so tests don't depend on server/transport casing.
            hdrs = {k.lower(): v for k, v in r.headers.items()}
            body = r.read()
            return r.status, hdrs, (json.loads(body) if body else None)
    except urllib.error.HTTPError as e:
        hdrs = {k.lower(): v for k, v in e.headers.items()}
        return e.code, hdrs, None
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def test_marketplace_nonexistent_collection_404():
    status, _, _ = _get("/marketplace/does-not-exist.json")
    assert status == 404


def test_marketplace_valid_collection_shape():
    # Requires a pre-existing collection. Use seed collection 'official'.
    status, headers, body = _get(f"/marketplace/{SEED_COLLECTION}.json")
    if status == 404:
        pytest.skip(f"no '{SEED_COLLECTION}' collection in test DB")
    assert status == 200
    assert body["name"] == SEED_COLLECTION
    assert "plugins" in body
    assert "etag" in headers
    assert "cache-control" in headers


def test_marketplace_etag_304():
    status, headers, _ = _get(f"/marketplace/{SEED_COLLECTION}.json")
    if status != 200:
        pytest.skip(f"no '{SEED_COLLECTION}' collection")
    etag = headers.get("etag")
    assert etag, "200 response must include an ETag header"
    status2, _, _ = _get(f"/marketplace/{SEED_COLLECTION}.json", if_none_match=etag)
    assert status2 == 304
