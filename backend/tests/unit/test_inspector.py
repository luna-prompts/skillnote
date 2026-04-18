"""Tests for inspector — detect kind + return preview."""
import os
import pytest

from app.services.imports.inspector import inspect_source, InspectResult
from app.services.imports.input_parser import parse_input

from tests.fixtures.mock_git_server import MockServer


def test_inspect_github_shorthand_returns_preview():
    with MockServer() as srv:
        srv.serve_repo("wshobson/agents", ref="main", sha="abc1234")
        os.environ["SKILLNOTE_IMPORT_GITHUB_API_BASE"] = srv.api_base
        parsed = parse_input("wshobson/agents")
        result = inspect_source(parsed, timeout_s=3)
        assert isinstance(result, InspectResult)
        assert result.kind in ("marketplace", "plugin", "skill_bundle", "single_skill")
        assert result.resolved_sha == "abc1234"


def test_inspect_nonexistent_repo_returns_error():
    with MockServer() as srv:
        srv.set_failure_mode("404")
        os.environ["SKILLNOTE_IMPORT_GITHUB_API_BASE"] = srv.api_base
        parsed = parse_input("nobody/nope")
        result = inspect_source(parsed, timeout_s=3)
        assert result.error_code == "REPO_NOT_FOUND"


def test_inspect_timeout():
    with MockServer() as srv:
        srv.set_failure_mode("timeout")
        os.environ["SKILLNOTE_IMPORT_GITHUB_API_BASE"] = srv.api_base
        parsed = parse_input("wshobson/agents")
        result = inspect_source(parsed, timeout_s=1)
        assert result.error_code == "UPSTREAM_TIMEOUT"
