"""Unit tests for the claude.ai plugin-bundle generator (git-free
'Upload plugin' path). Pure: ZIP bytes in, structure asserted."""

import io
import json
import zipfile

import pytest

from app.services.claude_ai_marketplace import (
    PluginAuthor,
    PluginManifest,
    PluginSkill,
    build_plugin_zip,
    compose_skill_md,
    slugify_collection,
)


def _read_zip(data: bytes) -> dict[str, str]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return {n: zf.read(n).decode() for n in zf.namelist()}


def test_bundle_has_manifest_and_skill_files():
    data = build_plugin_zip(
        [
            PluginSkill(slug="alpha", description="First skill.", content_md="# Alpha\nbody"),
            PluginSkill(slug="beta", description="Second skill.", content_md="# Beta"),
        ]
    )
    files = _read_zip(data)
    assert ".claude-plugin/plugin.json" in files
    assert "skills/alpha/SKILL.md" in files
    assert "skills/beta/SKILL.md" in files


def test_manifest_branding_uses_camelcase_displayname():
    manifest = PluginManifest(
        author=PluginAuthor(name="SkillNote", url="https://skillnote.example.com"),
        category="productivity",
        keywords=("skillnote", "registry"),
    )
    files = _read_zip(build_plugin_zip([PluginSkill("a", "d")], manifest))
    m = json.loads(files[".claude-plugin/plugin.json"])
    assert m["name"] == "skillnote"
    assert m["displayName"] == "SkillNote"  # camelCase per claude.ai schema
    assert m["author"] == {"name": "SkillNote", "url": "https://skillnote.example.com"}
    assert m["category"] == "productivity"
    assert m["keywords"] == ["skillnote", "registry"]


def test_skill_md_has_safe_frontmatter():
    # A description with a colon + newline must not break the frontmatter.
    nasty = "Does X: then Y\ninjected: not-a-key"
    md = compose_skill_md("my-skill", nasty, "# Body")
    assert md.startswith("---\n")
    head, body = md.split("---\n\n", 1)
    assert "name: my-skill" in head
    # the nasty value is quoted/escaped, not promoted to a top-level key
    import yaml

    parsed = yaml.safe_load(head.strip().strip("-").strip())
    assert parsed["name"] == "my-skill"
    assert parsed["description"] == nasty
    assert "injected" not in parsed  # would-be injection stayed inside the value
    assert body == "# Body"


def test_bytes_are_deterministic_for_same_skillset():
    skills = [PluginSkill("b", "two"), PluginSkill("a", "one")]
    a = build_plugin_zip(skills)
    b = build_plugin_zip(list(reversed(skills)))
    # slug-sorted + fixed timestamps => identical bytes regardless of input order
    assert a == b


def test_duplicate_slug_rejected():
    with pytest.raises(ValueError):
        build_plugin_zip([PluginSkill("dup", "x"), PluginSkill("dup", "y")])


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Frontend", "frontend"),
        ("Back End", "back-end"),
        ("Security & Auth!", "security-auth"),
        ("  spaced  ", "spaced"),
        ("data-pipeline", "data-pipeline"),
        ("***", "collection"),  # no usable chars → fallback
    ],
)
def test_slugify_collection_kebab(name, expected):
    slug = slugify_collection(name)
    assert slug == expected
    # always claude.ai-safe: lowercase letters, digits, hyphens
    import re

    assert re.fullmatch(r"[a-z0-9-]+", slug)


def test_collection_plugin_manifest_names():
    # The plugin name is the slug; the human label is "SkillNote: <name>".
    manifest = PluginManifest(
        name=slugify_collection("Front End"),
        display_name="SkillNote: Front End",
    )
    files = _read_zip(build_plugin_zip([PluginSkill("a", "d")], manifest))
    m = json.loads(files[".claude-plugin/plugin.json"])
    assert m["name"] == "front-end"
    assert m["displayName"] == "SkillNote: Front End"
