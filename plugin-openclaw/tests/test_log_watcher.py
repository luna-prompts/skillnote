"""
Tests for plugin-openclaw/skillnote/log-watcher.py

Run: python3 -m pytest plugin-openclaw/tests/test_log_watcher.py -v
"""

import importlib.util
import json
import os
import sys
import tempfile
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Load the module under test without executing __main__
# ---------------------------------------------------------------------------

_WATCHER_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "skillnote",
    "log-watcher.py",
)

spec = importlib.util.spec_from_file_location("log_watcher", _WATCHER_PATH)
log_watcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(log_watcher)

process_file = log_watcher.process_file
find_session_files = log_watcher.find_session_files
post_skill_used = log_watcher.post_skill_used


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_jsonl(path: str, lines: list) -> None:
    """Write a list of dicts as JSONL to path."""
    with open(path, "w") as f:
        for line in lines:
            f.write(json.dumps(line) + "\n")


def _skill_read_event(skill_path: str, msg_id: str = "msg1") -> dict:
    """Build a message event with a read toolCall for skill_path."""
    return {
        "type": "message",
        "id": msg_id,
        "message": {
            "role": "assistant",
            "content": [
                {
                    "type": "toolCall",
                    "name": "read",
                    "arguments": {"path": skill_path},
                }
            ],
        },
    }


def _session_event(session_id: str = "sess-1") -> dict:
    return {"type": "session", "id": session_id, "timestamp": "2026-01-01T00:00:00Z"}


# ---------------------------------------------------------------------------
# process_file tests
# ---------------------------------------------------------------------------

class TestProcessFile:
    def test_read_sn_skill_posts_event(self, tmp_path):
        """JSONL with a read toolCall for sn-code-review-checklist/SKILL.md → post called."""
        session_file = str(tmp_path / "main.jsonl")
        skill_path = f"{tmp_path}/sn-code-review-checklist/SKILL.md"
        _write_jsonl(session_file, [
            _session_event("sess-abc"),
            _skill_read_event(skill_path),
        ])

        state = {}
        with patch.object(log_watcher, "post_skill_used") as mock_post:
            process_file(session_file, state, "http://localhost:8082")
            mock_post.assert_called_once_with(
                "http://localhost:8082",
                "code-review-checklist",
                "sess-abc",
            )

    def test_read_non_sn_path_ignored(self, tmp_path):
        """read toolCall for /some/other/path/SKILL.md → no post."""
        session_file = str(tmp_path / "main.jsonl")
        _write_jsonl(session_file, [
            _session_event(),
            _skill_read_event("/some/other/path/SKILL.md"),
        ])

        state = {}
        with patch.object(log_watcher, "post_skill_used") as mock_post:
            process_file(session_file, state, "http://localhost:8082")
            mock_post.assert_not_called()

    def test_text_message_ignored(self, tmp_path):
        """Message with only text content → no post."""
        session_file = str(tmp_path / "main.jsonl")
        _write_jsonl(session_file, [
            _session_event(),
            {
                "type": "message",
                "id": "msg1",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": "hello"}],
                },
            },
        ])

        state = {}
        with patch.object(log_watcher, "post_skill_used") as mock_post:
            process_file(session_file, state, "http://localhost:8082")
            mock_post.assert_not_called()

    def test_byte_offset_tracking(self, tmp_path):
        """Process file, advance offset, add new line, process again → only new line processed."""
        session_file = str(tmp_path / "main.jsonl")
        skill_path_1 = f"{tmp_path}/sn-first-skill/SKILL.md"
        skill_path_2 = f"{tmp_path}/sn-second-skill/SKILL.md"

        _write_jsonl(session_file, [
            _session_event("sess-1"),
            _skill_read_event(skill_path_1, "msg1"),
        ])

        state = {}
        with patch.object(log_watcher, "post_skill_used") as mock_post:
            process_file(session_file, state, "http://localhost:8082")
            assert mock_post.call_count == 1
            assert mock_post.call_args[0][1] == "first-skill"

        # Append a second skill read
        with open(session_file, "a") as f:
            f.write(json.dumps(_skill_read_event(skill_path_2, "msg2")) + "\n")

        with patch.object(log_watcher, "post_skill_used") as mock_post2:
            process_file(session_file, state, "http://localhost:8082")
            # Only the new line (second-skill) should trigger a post
            assert mock_post2.call_count == 1
            assert mock_post2.call_args[0][1] == "second-skill"

    def test_inode_change_resets_state(self, tmp_path):
        """Same path, different inode → offset resets to 0, re-reads from start."""
        session_file = str(tmp_path / "main.jsonl")
        skill_path = f"{tmp_path}/sn-my-skill/SKILL.md"

        _write_jsonl(session_file, [
            _session_event("sess-old"),
            _skill_read_event(skill_path),
        ])

        state = {}
        with patch.object(log_watcher, "post_skill_used"):
            process_file(session_file, state, "http://localhost:8082")

        # Simulate inode change: replace the file with a new one (different inode)
        os.remove(session_file)
        _write_jsonl(session_file, [
            _session_event("sess-new"),
            _skill_read_event(skill_path),
        ])

        with patch.object(log_watcher, "post_skill_used") as mock_post:
            process_file(session_file, state, "http://localhost:8082")
            # Should re-process from offset 0 → one post for sess-new
            mock_post.assert_called_once()
            assert mock_post.call_args[0][2] == "sess-new"

    def test_partial_json_line_skipped(self, tmp_path):
        """File ends mid-JSON → no crash, next valid line processed."""
        session_file = str(tmp_path / "main.jsonl")
        skill_path = f"{tmp_path}/sn-good-skill/SKILL.md"

        with open(session_file, "w") as f:
            f.write(json.dumps(_session_event()) + "\n")
            f.write('{"type": "message", "incomplete":')  # truncated, no newline

        state = {}
        with patch.object(log_watcher, "post_skill_used") as mock_post:
            process_file(session_file, state, "http://localhost:8082")
            # No crash, no post (partial line is the only message, and session event
            # has no skill read)
            mock_post.assert_not_called()

        # Now append a complete valid skill read after the partial line
        with open(session_file, "a") as f:
            # Complete the partial line as garbage (will be skipped by JSONDecodeError)
            # then add a proper new event
            f.write("\n")
            f.write(json.dumps(_skill_read_event(skill_path)) + "\n")

        with patch.object(log_watcher, "post_skill_used") as mock_post2:
            process_file(session_file, state, "http://localhost:8082")
            # The partial line should be skipped, but the valid line processed
            mock_post2.assert_called_once()
            assert mock_post2.call_args[0][1] == "good-skill"

    def test_dedup_same_slug_in_session(self, tmp_path):
        """Same slug read twice in same session → post called only once."""
        session_file = str(tmp_path / "main.jsonl")
        skill_path = f"{tmp_path}/sn-dup-skill/SKILL.md"

        _write_jsonl(session_file, [
            _session_event("sess-dedup"),
            _skill_read_event(skill_path, "msg1"),
            _skill_read_event(skill_path, "msg2"),  # duplicate
        ])

        state = {}
        with patch.object(log_watcher, "post_skill_used") as mock_post:
            process_file(session_file, state, "http://localhost:8082")
            assert mock_post.call_count == 1

    def test_new_session_resets_dedup(self, tmp_path):
        """Slug read, then new session event, then same slug → post called twice total."""
        session_file = str(tmp_path / "main.jsonl")
        skill_path = f"{tmp_path}/sn-reset-skill/SKILL.md"

        # First pass: first session reads the skill
        _write_jsonl(session_file, [
            _session_event("sess-first"),
            _skill_read_event(skill_path, "msg1"),
        ])

        state = {}
        with patch.object(log_watcher, "post_skill_used") as mock_post:
            process_file(session_file, state, "http://localhost:8082")
            assert mock_post.call_count == 1

        # Append a new session event and the same skill read
        with open(session_file, "a") as f:
            f.write(json.dumps(_session_event("sess-second")) + "\n")
            f.write(json.dumps(_skill_read_event(skill_path, "msg2")) + "\n")

        with patch.object(log_watcher, "post_skill_used") as mock_post2:
            process_file(session_file, state, "http://localhost:8082")
            # New session resets dedup → should post again
            assert mock_post2.call_count == 1
            assert mock_post2.call_args[0][2] == "sess-second"


# ---------------------------------------------------------------------------
# find_session_files tests
# ---------------------------------------------------------------------------

class TestFindSessionFiles:
    def test_excludes_trajectory_files(self, tmp_path):
        """foo.trajectory.jsonl excluded."""
        (tmp_path / "foo.trajectory.jsonl").touch()
        result = find_session_files(str(tmp_path))
        assert not any("trajectory" in p for p in result)

    def test_excludes_reset_files(self, tmp_path):
        """foo.reset.2026.jsonl excluded."""
        (tmp_path / "foo.reset.2026.jsonl").touch()
        result = find_session_files(str(tmp_path))
        assert not any("reset" in p for p in result)

    def test_includes_normal_jsonl(self, tmp_path):
        """main.jsonl included."""
        (tmp_path / "main.jsonl").touch()
        result = find_session_files(str(tmp_path))
        assert any(p.endswith("main.jsonl") for p in result)

    def test_missing_dir_returns_empty(self, tmp_path):
        """Non-existent dir → returns []."""
        nonexistent = str(tmp_path / "does_not_exist")
        result = find_session_files(nonexistent)
        assert result == []


# ---------------------------------------------------------------------------
# post_skill_used tests (mock urllib)
# ---------------------------------------------------------------------------

class TestPostSkillUsed:
    def test_post_sends_correct_payload(self):
        """mock urllib.request.urlopen, verify JSON body has skill_slug, agent_name, session_id."""
        captured = {}

        def fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["body"] = json.loads(req.data.decode())
            captured["method"] = req.method
            captured["content_type"] = req.get_header("Content-type")
            return MagicMock()

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            post_skill_used("http://localhost:8082", "my-skill", "sess-xyz")

        assert captured["url"] == "http://localhost:8082/v1/hooks/skill-used"
        assert captured["method"] == "POST"
        assert captured["body"]["skill_slug"] == "my-skill"
        assert captured["body"]["agent_name"] == "openclaw-main"
        assert captured["body"]["session_id"] == "sess-xyz"
        assert captured["content_type"] == "application/json"

    def test_post_network_error_silent(self):
        """urlopen raises → no exception propagates."""
        with patch("urllib.request.urlopen", side_effect=OSError("connection refused")):
            # Must not raise
            post_skill_used("http://localhost:8082", "any-skill", "sess-1")
