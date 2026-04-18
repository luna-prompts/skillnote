"""Tests for manifest_schema — Pydantic models mirroring Claude Code's schemas."""
import json
from pathlib import Path

import pytest

from app.services.imports.manifest_schema import (
    Marketplace,
    SkillFrontmatter,
    ManifestError,
)

FIXTURE_DIR = Path(__file__).parent.parent / "fixtures" / "manifests"


def _load(name: str) -> dict:
    return json.loads((FIXTURE_DIR / name).read_text())


def test_minimal_valid_parses():
    m = Marketplace.model_validate(_load("minimal_valid.json"))
    assert m.name == "minimal"
    assert len(m.plugins) == 1


def test_github_source_parses():
    m = Marketplace.model_validate(_load("github_sources.json"))
    p = m.plugins[0]
    assert p.source.source == "github"
    assert p.source.repo == "wshobson/agents"


def test_missing_plugins_fails():
    with pytest.raises(Exception):
        Marketplace.model_validate(_load("malformed_missing_plugins.json"))


def test_wrong_type_fails():
    with pytest.raises(Exception):
        Marketplace.model_validate(_load("malformed_wrong_type.json"))


def test_empty_plugins_ok():
    m = Marketplace.model_validate(_load("empty_plugins.json"))
    assert m.plugins == []


def test_skill_frontmatter_valid():
    fm = SkillFrontmatter.model_validate({"name": "my-skill", "description": "Does stuff."})
    assert fm.name == "my-skill"


def test_skill_frontmatter_name_reserved():
    with pytest.raises(Exception):
        SkillFrontmatter.model_validate({"name": "claude-helper", "description": "nope"})


def test_skill_frontmatter_name_invalid_chars():
    with pytest.raises(Exception):
        SkillFrontmatter.model_validate({"name": "My Skill", "description": "bad case"})


def test_skill_description_too_long():
    with pytest.raises(Exception):
        SkillFrontmatter.model_validate({"name": "ok-name", "description": "x" * 1025})


def test_skill_name_too_long():
    with pytest.raises(Exception):
        SkillFrontmatter.model_validate({"name": "a" * 65, "description": "fine"})
