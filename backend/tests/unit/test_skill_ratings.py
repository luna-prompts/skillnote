"""Unit tests for the complete_skill MCP tool and rating helpers."""
import asyncio

import pytest
from unittest.mock import patch


class TestCompleteSkillValidation:
    """Test rating validation logic."""

    def test_rating_below_range(self):
        from mcp_server import complete_skill
        result = asyncio.get_event_loop().run_until_complete(complete_skill("test-skill", 0))
        assert "Error" in result
        assert "between 1 and 5" in result

    def test_rating_above_range(self):
        from mcp_server import complete_skill
        result = asyncio.get_event_loop().run_until_complete(complete_skill("test-skill", 6))
        assert "Error" in result
        assert "between 1 and 5" in result

    def test_nonexistent_skill(self):
        from mcp_server import complete_skill
        with patch("mcp_server._get_skill_version_sync", return_value=None):
            result = asyncio.get_event_loop().run_until_complete(complete_skill("nonexistent", 4))
        assert "Error" in result
        assert "not found" in result

    def test_valid_rating(self):
        from mcp_server import complete_skill
        with patch("mcp_server._get_skill_version_sync", return_value=3), \
             patch("mcp_server._insert_rating_sync") as mock_insert, \
             patch("mcp_server._resolve_session_meta", return_value={"client_name": "claude-code", "id": "sess-1"}):
            result = asyncio.get_event_loop().run_until_complete(
                complete_skill("my-skill", 4, "built the component")
            )

        assert "Completed" in result
        assert "4/5" in result
        mock_insert.assert_called_once_with("my-skill", 3, 4, "built the component", "claude-code", "sess-1")

    def test_valid_rating_no_outcome(self):
        from mcp_server import complete_skill
        with patch("mcp_server._get_skill_version_sync", return_value=1), \
             patch("mcp_server._insert_rating_sync") as mock_insert, \
             patch("mcp_server._resolve_session_meta", return_value=None):
            result = asyncio.get_event_loop().run_until_complete(
                complete_skill("my-skill", 5)
            )

        assert "Completed" in result
        mock_insert.assert_called_once_with("my-skill", 1, 5, None, "", "")


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
