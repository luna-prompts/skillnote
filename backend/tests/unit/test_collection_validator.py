"""Unit tests for collection name validation."""
import pytest
from app.validators.collection_validator import validate_collection_name


class TestValidateCollectionName:
    def test_name_with_spaces_rejected(self):
        # Spaces are no longer allowed (slug-only: [a-z0-9_-]+)
        errors = validate_collection_name("lp assessment")
        assert any(
            "lowercase" in e.lower() or "letters, numbers" in e for e in errors
        )

    def test_valid_single_word(self):
        assert validate_collection_name("frontend") == []

    def test_empty_rejected(self):
        errors = validate_collection_name("")
        assert any("required" in e.lower() for e in errors)

    def test_whitespace_only_rejected(self):
        errors = validate_collection_name("   ")
        assert any("required" in e.lower() for e in errors)

    def test_too_long_rejected(self):
        errors = validate_collection_name("x" * 129)
        assert any("128" in e for e in errors)

    def test_newline_rejected(self):
        errors = validate_collection_name("foo\nbar")
        assert any("newline" in e.lower() or "invalid" in e.lower() for e in errors)

    def test_xml_tag_rejected(self):
        errors = validate_collection_name("<script>")
        assert any("xml" in e.lower() or "tag" in e.lower() for e in errors)

    def test_boundary_128_chars_accepted(self):
        assert validate_collection_name("x" * 128) == []


def test_valid_slug_lowercase_hyphens_underscores_digits():
    assert validate_collection_name("frontend") == []
    assert validate_collection_name("my-app_2") == []
    assert validate_collection_name("a") == []
    assert validate_collection_name("a" * 128) == []


def test_rejects_uppercase():
    errs = validate_collection_name("Frontend")
    assert any("lowercase" in e.lower() or "letters, numbers" in e for e in errs)


def test_rejects_space():
    errs = validate_collection_name("my app")
    assert len(errs) >= 1


def test_rejects_special_chars():
    errs = validate_collection_name("foo!")
    assert len(errs) >= 1


def test_rejects_over_128_chars():
    errs = validate_collection_name("a" * 129)
    assert any("128" in e for e in errs)


def test_rejects_reserved_words():
    assert any("anthropic" in e for e in validate_collection_name("anthropic-stuff"))
    assert any("claude" in e for e in validate_collection_name("claude-code"))


def test_empty_is_rejected():
    assert validate_collection_name("") != []
    assert validate_collection_name("   ") != []
