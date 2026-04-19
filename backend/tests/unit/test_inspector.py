"""Tests for inspector — detect kind + return preview."""
import os
import pytest

from app.services.imports.inspector import inspect_source, InspectResult
from app.services.imports.input_parser import parse_input

from tests.fixtures.mock_git_server import MockServer


def _patch_clone(monkeypatch, *, sha="abc1234", skills=None, error_code=None, error_message=None):
    """Monkeypatch clone_and_scan to return a stub CloneResult without hitting the network.

    The inspector does `from app.services.imports.cloner import clone_and_scan` inside
    the function body, so we patch the module attribute directly.
    """
    from app.services.imports import cloner as cloner_mod

    def _stub(parsed, **kwargs):
        return cloner_mod.CloneResult(
            skills=skills or [],
            resolved_sha=sha,
            error_code=error_code,
            error_message=error_message,
        )

    monkeypatch.setattr(cloner_mod, "clone_and_scan", _stub)


def test_inspect_github_shorthand_returns_preview(monkeypatch):
    _patch_clone(monkeypatch, sha="abc1234")
    with MockServer() as srv:
        srv.serve_repo("wshobson/agents", ref="main", sha="abc1234")
        os.environ["SKILLNOTE_IMPORT_GITHUB_API_BASE"] = srv.api_base
        parsed = parse_input("wshobson/agents")
        result = inspect_source(parsed, timeout_s=3)
        assert isinstance(result, InspectResult)
        assert result.kind in ("marketplace", "plugin", "skill_bundle", "single_skill")
        assert result.resolved_sha == "abc1234"


def test_inspect_nonexistent_repo_returns_error(monkeypatch):
    _patch_clone(monkeypatch)
    with MockServer() as srv:
        srv.set_failure_mode("404")
        os.environ["SKILLNOTE_IMPORT_GITHUB_API_BASE"] = srv.api_base
        parsed = parse_input("nobody/nope")
        result = inspect_source(parsed, timeout_s=3)
        assert result.error_code == "REPO_NOT_FOUND"


def test_inspect_timeout(monkeypatch):
    _patch_clone(monkeypatch)
    with MockServer() as srv:
        srv.set_failure_mode("timeout")
        os.environ["SKILLNOTE_IMPORT_GITHUB_API_BASE"] = srv.api_base
        parsed = parse_input("wshobson/agents")
        result = inspect_source(parsed, timeout_s=1)
        assert result.error_code == "UPSTREAM_TIMEOUT"
