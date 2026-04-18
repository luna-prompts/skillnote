"""Unit tests for the slugify algorithm used by migration 0012."""
import importlib.util
import hashlib
from pathlib import Path


def _load():
    path = (
        Path(__file__).resolve().parents[2]
        / "alembic" / "versions" / "0012_slugify_collection_names.py"
    )
    spec = importlib.util.spec_from_file_location("m0012", path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_slugify_basic():
    m = _load()
    assert m._slugify("Frontend") == "frontend"
    assert m._slugify("lp assessment") == "lp-assessment"
    assert m._slugify("my-app") == "my-app"
    assert m._slugify("!!!") == ""


def test_slugify_collapses_and_strips():
    m = _load()
    assert m._slugify("   --Foo!!Bar--") == "foo-bar"


def test_fallback_uses_hash8():
    m = _load()
    expected = f"collection-{hashlib.sha1(b'!!!').hexdigest()[:8]}"
    assert m._fallback("!!!") == expected


def test_fallback_deterministic():
    m = _load()
    assert m._fallback("xyz") == m._fallback("xyz")
