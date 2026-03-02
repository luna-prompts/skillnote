"""Unit tests for _slugify() helper and name validation in the skills API."""
import re

import pytest

from app.validators.skill_validator import validate_skill_name

# ── Replicate _slugify from skills.py so we can unit-test it without importing the router ──

def _slugify(name: str) -> str:
    s = name.lower()
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    s = re.sub(r'\s+', '-', s)
    s = re.sub(r'-+', '-', s)
    s = s.strip('-')
    return s


# ── _slugify tests ────────────────────────────────────────────────────

class TestSlugify:
    def test_simple_kebab(self):
        assert _slugify("code-reviewer") == "code-reviewer"

    def test_spaces_to_hyphens(self):
        assert _slugify("API Reviewer") == "api-reviewer"

    def test_uppercase_lowered(self):
        assert _slugify("MySkill") == "myskill"

    def test_special_chars_stripped(self):
        assert _slugify("hello@world!") == "helloworld"

    def test_consecutive_spaces(self):
        assert _slugify("a   b   c") == "a-b-c"

    def test_consecutive_hyphens_collapsed(self):
        assert _slugify("a---b") == "a-b"

    def test_mixed_spaces_and_hyphens(self):
        assert _slugify("a - b - c") == "a-b-c"

    def test_leading_trailing_hyphens_stripped(self):
        assert _slugify("-hello-") == "hello"

    def test_empty_string(self):
        assert _slugify("") == ""

    def test_only_special_chars(self):
        assert _slugify("@#$%") == ""

    def test_numbers_preserved(self):
        assert _slugify("skill-v2") == "skill-v2"

    def test_unicode_stripped(self):
        assert _slugify("café-skill") == "caf-skill"

    def test_tabs_to_hyphens(self):
        assert _slugify("hello\tworld") == "hello-world"

    def test_newlines_to_hyphens(self):
        assert _slugify("hello\nworld") == "hello-world"

    def test_real_world_rename(self):
        """Simulates renaming 'API Reviewer' → 'Code Reviewer'."""
        assert _slugify("API Reviewer") == "api-reviewer"
        assert _slugify("Code Reviewer") == "code-reviewer"


# ── validate_skill_name tests ─────────────────────────────────────────

class TestValidateSkillName:
    def test_valid_name(self):
        assert validate_skill_name("my-skill") == []

    def test_valid_name_with_numbers(self):
        assert validate_skill_name("skill-v2") == []

    def test_empty_name(self):
        errors = validate_skill_name("")
        assert any("required" in e.lower() for e in errors)

    def test_whitespace_only(self):
        errors = validate_skill_name("   ")
        assert any("required" in e.lower() for e in errors)

    def test_uppercase_rejected(self):
        errors = validate_skill_name("MySkill")
        assert any("lowercase" in e.lower() for e in errors)

    def test_spaces_rejected(self):
        errors = validate_skill_name("my skill")
        assert any("lowercase" in e.lower() or "hyphens" in e.lower() for e in errors)

    def test_special_chars_rejected(self):
        errors = validate_skill_name("my@skill!")
        assert len(errors) > 0

    def test_max_length_exceeded(self):
        long_name = "a" * 65
        errors = validate_skill_name(long_name)
        assert any("64" in e or "fewer" in e.lower() for e in errors)

    def test_max_length_boundary(self):
        name_64 = "a" * 64
        assert validate_skill_name(name_64) == []

    def test_reserved_word_anthropic(self):
        errors = validate_skill_name("my-anthropic-skill")
        assert any("anthropic" in e.lower() for e in errors)

    def test_reserved_word_claude(self):
        errors = validate_skill_name("claude-helper")
        assert any("claude" in e.lower() for e in errors)

    def test_xml_tag_rejected(self):
        errors = validate_skill_name("<script>alert</script>")
        assert len(errors) > 0

    def test_underscores_rejected(self):
        errors = validate_skill_name("my_skill")
        assert len(errors) > 0
