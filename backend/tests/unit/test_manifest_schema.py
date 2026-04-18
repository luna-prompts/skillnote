"""Tests for manifest_schema — Pydantic models mirroring Claude Code's schemas."""
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.services.imports.manifest_schema import (
    GitHubPluginSource,
    GitSubdirPluginSource,
    Marketplace,
    SkillFrontmatter,
    ManifestError,
    UrlPluginSource,
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
    assert isinstance(p.source, GitHubPluginSource)
    assert p.source.source == "github"
    assert p.source.repo == "wshobson/agents"


def test_url_source_parses():
    m = Marketplace.model_validate(_load("url_source.json"))
    p = m.plugins[0]
    assert isinstance(p.source, UrlPluginSource)
    assert p.source.url == "https://example.com/skill.zip"


def test_git_subdir_source_parses():
    m = Marketplace.model_validate(_load("git_subdir.json"))
    p = m.plugins[0]
    assert isinstance(p.source, GitSubdirPluginSource)
    assert p.source.path == "plugins/foo"
    assert p.source.ref == "main"


def test_git_subdir_empty_path_fails():
    with pytest.raises(ValidationError):
        Marketplace.model_validate({
            "name": "bad",
            "owner": {"name": "X"},
            "plugins": [{"name": "p", "source": {"source": "git-subdir", "url": "u", "path": ""}}],
        })


def test_missing_plugins_fails():
    with pytest.raises(ValidationError):
        Marketplace.model_validate(_load("malformed_missing_plugins.json"))


def test_wrong_type_fails():
    with pytest.raises(ValidationError):
        Marketplace.model_validate(_load("malformed_wrong_type.json"))


def test_empty_plugins_ok():
    m = Marketplace.model_validate(_load("empty_plugins.json"))
    assert m.plugins == []


def test_skill_frontmatter_valid():
    fm = SkillFrontmatter.model_validate({"name": "my-skill", "description": "Does stuff."})
    assert fm.name == "my-skill"


def test_skill_frontmatter_name_reserved():
    with pytest.raises(ValidationError):
        SkillFrontmatter.model_validate({"name": "claude-helper", "description": "nope"})


def test_skill_frontmatter_name_invalid_chars():
    with pytest.raises(ValidationError):
        SkillFrontmatter.model_validate({"name": "My Skill", "description": "bad case"})


def test_skill_description_too_long():
    with pytest.raises(ValidationError):
        SkillFrontmatter.model_validate({"name": "ok-name", "description": "x" * 1025})


def test_skill_name_too_long():
    with pytest.raises(ValidationError):
        SkillFrontmatter.model_validate({"name": "a" * 65, "description": "fine"})
