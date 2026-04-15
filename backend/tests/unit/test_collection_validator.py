"""Unit tests for collection name validation."""
from app.validators.collection_validator import validate_collection_name


class TestValidateCollectionName:
    def test_valid_name_with_spaces(self):
        assert validate_collection_name("lp assessment") == []

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
