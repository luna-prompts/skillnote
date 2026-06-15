"""Generate a claude.ai *plugin bundle* (one named group containing all
sync-enabled skills) for the git-free "Upload plugin" path.

This is a SEPARATE channel from the per-skill ``upload-skill`` flow in
``claude_ai.py``. Live testing of claude.ai's internal API (2026-06-07,
see ``docs/claude-ai-endpoints.md``) established that:

* A self-hosted instance can appear as its OWN named group under "Personal
  plugins" by POSTing a ZIP to
  ``/marketplaces/{id}/plugins/account-upload?overwrite=true`` — no git, no
  GitHub, fully drivable by the extension with cookie auth.
* The ZIP is a *plugin*: ``.claude-plugin/plugin.json`` carries the branding
  (``display_name``, ``description``, ``author``, ``category``) and
  ``skills/<slug>/SKILL.md`` holds each skill. ``commands/<name>.md`` become
  native slash commands.
* The group is replace-as-a-whole: there is no per-skill delete/download, so
  the whole bundle is rebuilt and re-uploaded on every sync (delete == omit a
  skill from the next ZIP). This module always emits the *complete* current
  set of sync-enabled skills.
* ``plugin.json`` wins over a bundled ``marketplace.json`` for this path; the
  ``version`` field is ignored (claude.ai assigns its own upload counter), so
  we do not rely on it.

The functions here are pure (DB rows in, ZIP bytes out) to keep them trivially
testable; the API/extension layer handles auth and the actual upload.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from typing import Iterable, Optional

import yaml

PLUGIN_NAME = "skillnote"
PLUGIN_DISPLAY_NAME = "SkillNote"
PLUGIN_DESCRIPTION = "Skills synced from your self-hosted SkillNote registry."

# Marketplace + group naming. Every published collection becomes one plugin
# group "SkillNote: <Collection>" under the single "SkillNote" marketplace.
MARKETPLACE_NAME = "SkillNote"
GROUP_DISPLAY_PREFIX = "SkillNote: "


def slugify_collection(name: str) -> str:
    """Kebab-case a collection name for use as a claude.ai plugin ``name``.

    claude.ai's marketplace sync rejects names with uppercase / spaces /
    special chars, so we lowercase and collapse any run of non
    [a-z0-9] into a single hyphen. The original name is preserved as the
    plugin ``displayName`` (prefixed "SkillNote: "). Falls back to
    ``"collection"`` if the name has no usable characters.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "collection"


@dataclass(frozen=True)
class PluginSkill:
    """One skill to ship in the bundle. ``slug`` must already be kebab-case
    (SkillNote's ``^[a-z0-9-]+$`` rule guarantees this; claude.ai's
    marketplace sync rejects non-kebab names)."""

    slug: str
    description: str
    content_md: str = ""


@dataclass(frozen=True)
class PluginAuthor:
    name: str
    email: Optional[str] = None
    url: Optional[str] = None

    def to_json(self) -> dict:
        out: dict[str, str] = {"name": self.name}
        if self.email:
            out["email"] = self.email
        if self.url:
            out["url"] = self.url
        return out


@dataclass(frozen=True)
class PluginManifest:
    name: str = PLUGIN_NAME
    display_name: str = PLUGIN_DISPLAY_NAME
    description: str = PLUGIN_DESCRIPTION
    author: Optional[PluginAuthor] = None
    category: Optional[str] = None
    keywords: tuple[str, ...] = field(default_factory=tuple)

    def to_json(self) -> dict:
        # camelCase keys: claude.ai's plugin.json schema uses displayName.
        out: dict = {
            "name": self.name,
            "displayName": self.display_name,
            "description": self.description,
        }
        if self.author is not None:
            out["author"] = self.author.to_json()
        if self.category:
            out["category"] = self.category
        if self.keywords:
            out["keywords"] = list(self.keywords)
        return out


@dataclass(frozen=True)
class CollectionPlugin:
    """One published collection → one claude.ai plugin group."""

    manifest: PluginManifest
    skills: tuple[PluginSkill, ...]


def collect_published_collection_plugins(
    db, author: Optional["PluginAuthor"] = None
) -> list[CollectionPlugin]:
    """Build a :class:`CollectionPlugin` for every collection toggled
    ``published_to_claude_ai`` that has at least one skill.

    Each becomes its own named group ("SkillNote: <name>"). A skill in
    several published collections appears in each (claude.ai namespaces skill
    files by plugin, and the usage scanner dedups by slug). Empty published
    collections are skipped so we don't upload a group with no skills.
    Results are sorted by plugin name for deterministic output.
    """
    from sqlalchemy import select, text

    from app.db.models import Collection, Skill, SkillContentVersion

    published = db.execute(
        select(Collection.name, Collection.description)
        .where(Collection.published_to_claude_ai.is_(True))
        .order_by(Collection.name)
    ).all()

    out: list[CollectionPlugin] = []
    for name, description in published:
        rows = db.execute(
            select(
                Skill.slug,
                SkillContentVersion.description,
                SkillContentVersion.content_md,
            )
            .join(SkillContentVersion, SkillContentVersion.skill_id == Skill.id)
            .where(SkillContentVersion.is_latest.is_(True))
            # Case-INSENSITIVE membership. A plain ``collections.any(name)``
            # compiles to ``name = ANY(collections)`` (case-sensitive), so a
            # collection whose stored ``Collection.name`` casing differs from
            # the casing inside a skill's ``collections`` array (e.g. "Frontend"
            # row vs "frontend" in the array — exactly what the publish toggle
            # can materialize) would match ZERO skills and silently publish an
            # empty group. Match case-insensitively to mirror list/delete.
            .where(
                text(
                    "EXISTS (SELECT 1 FROM unnest(skill_content_versions.collections) AS c "
                    "WHERE lower(c) = lower(:cname))"
                ).bindparams(cname=name)
            )
        ).all()
        skills = tuple(
            PluginSkill(slug=s, description=d or "", content_md=c or "")
            for (s, d, c) in rows
        )
        if not skills:
            continue
        manifest = PluginManifest(
            name=slugify_collection(name),
            display_name=f"{GROUP_DISPLAY_PREFIX}{name}",
            description=description or PLUGIN_DESCRIPTION,
            author=author,
        )
        out.append(CollectionPlugin(manifest=manifest, skills=skills))
    return sorted(out, key=lambda cp: cp.manifest.name)


def compose_skill_md(slug: str, description: str, content_md: str) -> str:
    """SKILL.md = YAML frontmatter (name+description) + body.

    Uses ``yaml.safe_dump`` so a description with newlines/colons/quotes
    can't break the frontmatter or inject extra YAML keys (mirrors the
    hardening already in ``claude_ai.get_skill_bundle``).
    """
    frontmatter = yaml.safe_dump(
        {"name": slug, "description": description},
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
    )
    return f"---\n{frontmatter}---\n\n" + (content_md or "")


def build_plugin_zip(
    skills: Iterable[PluginSkill],
    manifest: Optional[PluginManifest] = None,
) -> bytes:
    """Build the plugin ZIP for the "SkillNote" group.

    Layout (verified to render as a named group with branding + skills):

        .claude-plugin/plugin.json
        skills/<slug>/SKILL.md      (one per skill)

    Skills are emitted in slug order for deterministic, reproducible bytes
    (so an unchanged skill set hashes the same and we can skip a no-op
    re-upload). Raises ``ValueError`` if a slug is duplicated.
    """
    manifest = manifest or PluginManifest()
    ordered = sorted(skills, key=lambda s: s.slug)

    seen: set[str] = set()
    for s in ordered:
        if s.slug in seen:
            raise ValueError(f"duplicate skill slug in bundle: {s.slug}")
        seen.add(s.slug)

    buf = io.BytesIO()
    # Fixed date_time on each entry keeps the bytes deterministic across runs
    # (ZipInfo defaults to "now", which would defeat content-hash dedup).
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        info = zipfile.ZipInfo(".claude-plugin/plugin.json", date_time=(1980, 1, 1, 0, 0, 0))
        zf.writestr(info, json.dumps(manifest.to_json(), indent=2, ensure_ascii=False))
        for s in ordered:
            si = zipfile.ZipInfo(f"skills/{s.slug}/SKILL.md", date_time=(1980, 1, 1, 0, 0, 0))
            zf.writestr(si, compose_skill_md(s.slug, s.description, s.content_md))
    return buf.getvalue()
