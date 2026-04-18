"""Tests for the input parser — mirrors Claude Code's parseMarketplaceInput.ts behavior."""
import pytest

from app.services.imports.input_parser import parse_input


# Happy paths
@pytest.mark.parametrize("inp,expected", [
    ("wshobson/agents",
     {"source_type": "github", "repo": "wshobson/agents"}),
    ("wshobson/agents@v1.0.0",
     {"source_type": "github", "repo": "wshobson/agents", "ref": "v1.0.0"}),
    ("wshobson/agents#main",
     {"source_type": "github", "repo": "wshobson/agents", "ref": "main"}),
    ("https://github.com/wshobson/agents",
     {"source_type": "git", "url": "https://github.com/wshobson/agents.git"}),
    ("https://github.com/wshobson/agents.git",
     {"source_type": "git", "url": "https://github.com/wshobson/agents.git"}),
    ("https://github.com/wshobson/agents.git#main",
     {"source_type": "git", "url": "https://github.com/wshobson/agents.git", "ref": "main"}),
    ("https://example.com/marketplace.json",
     {"source_type": "url", "url": "https://example.com/marketplace.json"}),
    ("git@github.com:wshobson/agents.git",
     {"source_type": "git", "url": "git@github.com:wshobson/agents.git"}),
    ("org-123456@github.com:wshobson/agents.git",
     {"source_type": "git", "url": "org-123456@github.com:wshobson/agents.git"}),
    ("deploy@gitlab.com:group/project.git",
     {"source_type": "git", "url": "deploy@gitlab.com:group/project.git"}),
    ("git@github.com:wshobson/agents.git#dev",
     {"source_type": "git", "url": "git@github.com:wshobson/agents.git", "ref": "dev"}),
    ("https://dev.azure.com/org/proj/_git/repo",
     {"source_type": "git", "url": "https://dev.azure.com/org/proj/_git/repo"}),
    ("/abs/path",
     {"source_type": "directory", "path": "/abs/path"}),
    ("./local/path",
     {"source_type": "directory"}),  # path resolved absolutely — test only source_type
])
def test_parser_happy(inp, expected):
    result = parse_input(inp)
    assert result is not None and "error" not in result
    for key, val in expected.items():
        assert result[key] == val, f"{inp}: {key} mismatch"


# Rejects
@pytest.mark.parametrize("inp", [
    "", "   ", "@foo", "owner", "owner/", "/repo", "owner/repo:weird",
    "https://", "https:///",
    "file:///etc/passwd", "javascript:alert(1)", "ftp://example.com/",
    "mailto:someone@example.com",
    "owner/repo with spaces",
    "owner/repo\nembedded newline",
    "owner/repo\0null",
    "owner/repo@../../../../etc/passwd",
    "a" * 5000,  # absurdly long
])
def test_parser_rejects(inp):
    result = parse_input(inp)
    assert result is None or "error" in result, f"expected rejection, got {result}"


# Unicode / boundary
def test_unicode_name_allowed_through_parser():
    """Parser doesn't validate name — that's the schema's job. Ensures no crash."""
    result = parse_input("owner/弾")
    assert result is not None  # parser accepts; validator rejects later


def test_very_long_ref():
    long_ref = "a" * 200
    result = parse_input(f"owner/repo@{long_ref}")
    assert result is not None and result.get("ref") == long_ref


# Fuzzing — never crashes
from hypothesis import given, strategies as st, settings

@given(st.text(min_size=0, max_size=500))
@settings(max_examples=300, deadline=None)
def test_parser_never_crashes(s):
    """Parser must return None, {error:...}, or a valid ParsedSource dict. Never raise."""
    try:
        result = parse_input(s)
    except Exception as e:
        pytest.fail(f"parser raised on input {s!r}: {e}")
    assert result is None or isinstance(result, dict)
