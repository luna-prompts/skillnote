"""Post-migration smoke test for 0012.

Verifies that after the backend starts (which runs `alembic upgrade head`
per the Dockerfile), every collection name returned by /v1/collections
matches the new regex. Skips if API unreachable.
"""
import json
import os
import re
import urllib.error
import urllib.request

import pytest

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
NAME_PATTERN = re.compile(r"^[a-z0-9_-]+$")


def _get_collections():
    try:
        with urllib.request.urlopen(f"{BASE_URL}/v1/collections") as r:
            return json.loads(r.read())
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


def test_all_collection_names_are_valid_slugs():
    cols = _get_collections()
    bad = [c["name"] for c in cols if not NAME_PATTERN.match(c["name"])]
    assert not bad, f"Non-slug collection names still present after migration: {bad}"


def test_collection_names_are_bounded():
    cols = _get_collections()
    over = [c["name"] for c in cols if len(c["name"]) > 128]
    assert not over, f"Names over 128 chars: {over}"
