"""Unit tests for pure helpers in skillnote-pick."""
import importlib.util
import sys
from importlib.machinery import SourceFileLoader
from pathlib import Path


def _load_module():
    path = Path(__file__).resolve().parents[1] / "bin" / "skillnote-pick"
    # skillnote-pick has no .py extension, so pass an explicit loader
    loader = SourceFileLoader("skillnote_pick", str(path))
    spec = importlib.util.spec_from_file_location("skillnote_pick", path, loader=loader)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_slugify_lowercases():
    m = _load_module()
    assert m._slugify("Frontend") == "frontend"


def test_slugify_replaces_spaces():
    m = _load_module()
    assert m._slugify("My App") == "my-app"


def test_slugify_collapses_and_strips():
    m = _load_module()
    assert m._slugify("  --My!!!App-- ") == "my-app"


def test_slugify_returns_empty_for_all_invalid():
    m = _load_module()
    assert m._slugify("!!!") == ""


def test_is_valid_slug():
    m = _load_module()
    assert m._is_valid_slug("frontend") is True
    assert m._is_valid_slug("my-app_2") is True
    assert m._is_valid_slug("My App") is False
    assert m._is_valid_slug("") is False
    assert m._is_valid_slug("claude-stuff") is False  # reserved word


def test_resolve_recommendation_match():
    m = _load_module()
    existing = [("frontend", 5, []), ("backend", 3, [])]
    assert m._resolve_recommendation("Frontend", existing) == ("pick", 0)


def test_resolve_recommendation_create():
    m = _load_module()
    existing = [("frontend", 5, [])]
    assert m._resolve_recommendation("My App", existing) == ("create", "my-app")


def test_resolve_recommendation_none():
    m = _load_module()
    existing = [("frontend", 5, [])]
    assert m._resolve_recommendation("!!!", existing) == ("none", None)
