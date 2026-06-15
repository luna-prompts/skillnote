"""Integration tests for the scalable /v1/collections query params added for
the extension's collection picker: ?q= (search), ?published= (filter),
?limit= (cap), and the X-Total-Count header. All are ADDITIVE — the no-param
call must keep the original full-list behavior the web app relies on.

Requires a running backend on 127.0.0.1:8082 (override SKILLNOTE_TEST_BASE_URL).
Tests skip if the API is unreachable.
"""
import json
import os
import urllib.error
import urllib.request
import uuid

import pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")


def _request(method: str, path: str, body: dict | None = None):
    """Return (status, json_body, headers)."""
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        method=method,
        headers={"Content-Type": "application/json"} if body else {},
        data=(json.dumps(body).encode() if body is not None else None),
    )
    # HTTP header names are case-insensitive on the wire (Starlette emits
    # lowercase), so normalize keys to lowercase for stable lookups.
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode()
            hdrs = {k.lower(): v for k, v in r.headers.items()}
            return r.status, (json.loads(text) if text else None), hdrs
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        hdrs = {k.lower(): v for k, v in e.headers.items()}
        return e.code, (json.loads(text) if text else None), hdrs
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


@pytest.fixture
def seeded_collection():
    """Create a skill in a uniquely-named collection so filter/search tests have
    a deterministic target. Yields the collection name; cleans up the skill."""
    suffix = uuid.uuid4().hex[:8]
    name = f"zzfilter-{suffix}"
    slug = f"filter-skill-{suffix}"
    status, _, _ = _request(
        "POST",
        "/v1/skills",
        {
            "name": slug,
            "slug": slug,
            "description": "Filtering test skill.",
            "content_md": "# x\n\nbody",
            "collections": [name],
        },
    )
    if status != 201:
        pytest.skip(f"could not seed skill: {status}")
    yield name, slug
    _request("DELETE", f"/v1/skills/{slug}")


def test_no_params_returns_full_list_with_total_header():
    """The web app's existing call must be unchanged + now carry X-Total-Count."""
    status, cols, headers = _request("GET", "/v1/collections")
    assert status == 200
    assert isinstance(cols, list)
    # Header present and equals the returned row count when uncapped.
    assert "x-total-count" in headers
    assert int(headers["x-total-count"]) == len(cols)


def test_q_filters_by_name_substring(seeded_collection):
    name, _ = seeded_collection
    status, cols, _ = _request("GET", f"/v1/collections?q={name[:9]}")
    assert status == 200
    names = [c["name"] for c in cols]
    assert name in names
    # Every returned row must actually match the query (case-insensitive).
    assert all(name[:9].lower() in c["name"].lower() for c in cols)


def test_q_no_match_returns_empty(seeded_collection):
    status, cols, headers = _request(
        "GET", "/v1/collections?q=zzz-definitely-no-such-collection-xyz"
    )
    assert status == 200
    assert cols == []
    assert int(headers["x-total-count"]) == 0


def test_published_filter_excludes_unpublished(seeded_collection):
    """A freshly-seeded collection is unpublished, so it must NOT appear when
    filtering published=true, but MUST appear with published=false."""
    name, _ = seeded_collection
    _, pub, _ = _request("GET", "/v1/collections?published=true")
    _, unpub, _ = _request("GET", "/v1/collections?published=false")
    pub_names = [c["name"] for c in pub]
    unpub_names = [c["name"] for c in unpub]
    assert name not in pub_names
    assert name in unpub_names
    # Every published row really is published.
    assert all(c["published_to_claude_ai"] is True for c in pub)


def test_limit_caps_rows_but_total_header_is_true_count(seeded_collection):
    status, cols, headers = _request("GET", "/v1/collections?limit=1")
    assert status == 200
    assert len(cols) <= 1
    # The header reflects the FULL count for the filter, not the capped page.
    total = int(headers["x-total-count"])
    assert total >= 1
    if total > 1:
        assert len(cols) == 1  # actually capped


def test_limit_zero_means_uncapped(seeded_collection):
    """limit=0 (the default) returns everything — no accidental cap."""
    _, all_cols, headers = _request("GET", "/v1/collections?limit=0")
    assert len(all_cols) == int(headers["x-total-count"])


def test_limit_rejects_over_max():
    """limit is bounded [0,500]; an over-max value is a 422, not a huge scan."""
    status, _, _ = _request("GET", "/v1/collections?limit=99999")
    assert status == 422
