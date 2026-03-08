"""Unit tests for the CompleteSkillTool and rating helpers."""
import asyncio

import pytest
from unittest.mock import patch


def _run_complete_skill(skill_slug, rating, outcome=""):
    """Helper: instantiate CompleteSkillTool and run it with given arguments."""
    from mcp_server import CompleteSkillTool
    tool = CompleteSkillTool(
        name="complete_skill",
        description="test",
        parameters={"type": "object", "properties": {}},
    )
    arguments = {"skill_slug": skill_slug, "rating": rating}
    if outcome:
        arguments["outcome"] = outcome
    result = asyncio.get_event_loop().run_until_complete(tool.run(arguments))
    return result.content[0].text if hasattr(result.content[0], "text") else str(result.content[0])


class TestCompleteSkillValidation:
    """Test rating validation logic."""

    def test_rating_below_range(self):
        result = _run_complete_skill("test-skill", 0)
        assert "Error" in result
        assert "between 1 and 5" in result

    def test_rating_above_range(self):
        result = _run_complete_skill("test-skill", 6)
        assert "Error" in result
        assert "between 1 and 5" in result

    def test_rating_not_int(self):
        result = _run_complete_skill("test-skill", 3.5)
        assert "Error" in result
        assert "between 1 and 5" in result

    def test_nonexistent_skill(self):
        with patch("mcp_server._get_skill_version_sync", return_value=(None, None)):
            result = _run_complete_skill("nonexistent", 4)
        assert "Error" in result
        assert "not found" in result

    def test_database_error(self):
        with patch("mcp_server._get_skill_version_sync", return_value=(None, "database error")):
            result = _run_complete_skill("my-skill", 4)
        assert "Error" in result
        assert "database unavailable" in result

    def test_valid_rating(self):
        with patch("mcp_server._get_skill_version_sync", return_value=(3, None)), \
             patch("mcp_server._insert_rating_sync", return_value=None) as mock_insert, \
             patch("mcp_server._resolve_session_meta", return_value={"client_name": "claude-code", "id": "sess-1"}):
            result = _run_complete_skill("my-skill", 4, "built the component")

        assert "Completed" in result
        assert "4/5" in result
        mock_insert.assert_called_once_with("my-skill", 3, 4, "built the component", "claude-code", "sess-1")

    def test_valid_rating_no_outcome(self):
        with patch("mcp_server._get_skill_version_sync", return_value=(1, None)), \
             patch("mcp_server._insert_rating_sync", return_value=None) as mock_insert, \
             patch("mcp_server._resolve_session_meta", return_value=None):
            result = _run_complete_skill("my-skill", 5)

        assert "Completed" in result
        mock_insert.assert_called_once_with("my-skill", 1, 5, None, "", "")

    def test_insert_failure(self):
        with patch("mcp_server._get_skill_version_sync", return_value=(2, None)), \
             patch("mcp_server._insert_rating_sync", return_value="failed to save rating"), \
             patch("mcp_server._resolve_session_meta", return_value=None):
            result = _run_complete_skill("my-skill", 3)

        assert "Error" in result
        assert "could not be saved" in result

    def test_outcome_truncated(self):
        long_outcome = "x" * 3000
        with patch("mcp_server._get_skill_version_sync", return_value=(1, None)), \
             patch("mcp_server._insert_rating_sync", return_value=None) as mock_insert, \
             patch("mcp_server._resolve_session_meta", return_value=None):
            _run_complete_skill("my-skill", 4, long_outcome)

        # outcome should be capped at 2000 chars
        call_args = mock_insert.call_args[0]
        assert len(call_args[3]) == 2000


class TestResolveSessionMeta:
    def test_empty_connections(self):
        from mcp_server import _resolve_session_meta, _active_connections
        original = dict(_active_connections)
        _active_connections.clear()
        try:
            result = _resolve_session_meta()
            assert result is None
        finally:
            _active_connections.update(original)

    def test_picks_most_recent(self):
        from mcp_server import _resolve_session_meta, _active_connections
        original = dict(_active_connections)
        _active_connections.clear()
        _active_connections["a"] = {"client_name": "old", "last_seen": 1.0, "id": "a"}
        _active_connections["b"] = {"client_name": "new", "last_seen": 2.0, "id": "b"}
        try:
            result = _resolve_session_meta()
            assert result is not None
            assert result["client_name"] == "new"
        finally:
            _active_connections.clear()
            _active_connections.update(original)
