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


def test_clamp_with_suffix_never_exceeds_max():
    m = _load()
    # Base at max length — suffix must fit within 128 total
    base = "a" * 128
    assert len(m._clamp_with_suffix(base, "-2")) == 128
    assert len(m._clamp_with_suffix(base, "-99")) == 128
    # Short base — no truncation, plain concat
    assert m._clamp_with_suffix("foo", "-2") == "foo-2"
    # Base shorter than allowance — suffix appended as-is
    assert m._clamp_with_suffix("x", "-5") == "x-5"


def test_c1_preexisting_valid_slug_not_clobbered():
    """Regression test: an invalid name whose collision-resolved slug would
    match a pre-existing valid slug must NOT clobber it."""
    from datetime import datetime, timedelta, timezone
    m = _load()
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rows = [
        ("Foo!", t0),                         # invalid → slug 'foo'
        ("bar", t0 + timedelta(days=1)),      # valid, reserved
        ("Foo@", t0 + timedelta(days=2)),     # invalid → slug 'foo' collides
        ("foo-2", t0 + timedelta(days=3)),    # valid, MUST be preserved
    ]
    rename = m._build_rename_map(rows)
    assert rename["Foo!"] == "foo"
    assert rename["Foo@"] == "foo-3"           # skipped 'foo-2' because it's reserved
    assert "foo-2" not in rename               # pre-existing valid slug not touched
    assert "bar" not in rename


def test_idempotent_on_all_valid():
    """When every name is already a valid slug, rename map is empty."""
    from datetime import datetime, timezone
    m = _load()
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rows = [("frontend", t0), ("backend", t0), ("devops", t0)]
    assert m._build_rename_map(rows) == {}


def test_clamp_with_suffix_rstrips_trailing_hyphen():
    m = _load()
    # Base ending in hyphen after truncation — rstrip leaves 125 chars, plus '-2' = 127
    assert m._clamp_with_suffix("a" * 125 + "-", "-2") == "a" * 125 + "-2"
    # Multiple trailing hyphens
    assert m._clamp_with_suffix("a" * 124 + "---", "-2") == "a" * 124 + "-2"


def test_clamp_with_suffix_empty_suffix():
    m = _load()
    # Empty suffix — caps base at MAX_LEN
    assert m._clamp_with_suffix("a" * 150, "") == "a" * 128
    # Empty suffix with trailing hyphen after truncation — rstrip
    assert m._clamp_with_suffix("a" * 127 + "-", "") == "a" * 127
