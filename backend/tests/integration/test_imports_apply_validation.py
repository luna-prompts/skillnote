"""Integration tests for per-skill validation during apply (Task 27).

The importer runs SkillFrontmatter + path-safety checks for each candidate
skill. Invalid entries land in ``skipped[]`` with ``reason=validation_failed``.
If EVERY skill fails, the whole apply 422s with ``ALL_SKILLS_INVALID`` so the
user sees a clear signal instead of a silent zero-import success.

We stub ``app.api.imports.inspect_source`` so the tests don't hit GitHub and
don't require git. The endpoint resolves inspect_source at request time via
``from ... import inspect_source``, so that module-level binding is the one
to patch.
"""
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.imports.inspector import InspectResult


client = TestClient(app)


def _make_stub_inspect(skills):
    def _stub(parsed, *, token=None, timeout_s=30):
        owner, repo = parsed["repo"].split("/") if parsed.get("repo") else ("t", "r")
        return InspectResult(
            source_type="github", url=f"github.com/{owner}/{repo}",
            host="github.com", owner=owner, repo=repo,
            ref="main", resolved_sha="abc1234",
            kind="plugin", skills=skills,
        )
    return _stub


@pytest.fixture
def cleanup_slugs():
    """Clean up sources/collections + any global-named test skills on teardown.

    The tests use short global slugs ("good-skill", "evil", etc.) that would
    leak across runs if not cleaned — so we also scrub those plus any rename
    siblings ("good-skill-2"). Cheap because these names aren't used outside
    this file.
    """
    tracked = []
    # Global skill names these tests create (plus rename siblings like -2, -3).
    _SKILL_NAMES = (
        "good-skill", "ok-skill", "claude-helper", "evil",
        "claude-bad", "anthropic-bad",
    )
    yield tracked
    from app.db.session import SessionLocal
    from app.db.models import Skill, Collection, ImportSource
    try:
        with SessionLocal() as db:
            # Scrub test-authored skills by name (+ rename variants).
            for base in _SKILL_NAMES:
                db.query(Skill).filter(
                    Skill.slug.like(f"{base}%")
                ).delete(synchronize_session=False)
            # Drop sources and collections tracked by this run.
            for slug in tracked:
                db.query(ImportSource).filter(
                    ImportSource.collection_name == slug
                ).delete(synchronize_session=False)
                db.query(Collection).filter(Collection.name == slug).delete(
                    synchronize_session=False
                )
            db.commit()
    except Exception:
        pass


def test_reserved_name_rejected_in_selection(monkeypatch, cleanup_slugs):
    """A skill named 'claude-helper' (reserved word) is skipped with validation_failed."""
    slug = f"val-reserved-{uuid.uuid4().hex[:6]}"
    cleanup_slugs.append(slug)
    monkeypatch.setattr(
        "app.api.imports.inspect_source",
        _make_stub_inspect([
            {"name": "good-skill", "description": "ok", "path": "skills/good", "content_hash": "h1"},
            {"name": "claude-helper", "description": "uses reserved word", "path": "skills/c", "content_hash": "h2"},
        ]),
    )
    r = client.post("/v1/import/apply", json={
        "input": "o/r",
        "target_collection_slug": slug,
        "on_conflict": "rename",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    imported_names = {s["name"] for s in body["imported"]}
    assert "good-skill" in imported_names
    skipped_names = {s["name"] for s in body["skipped"]}
    assert "claude-helper" in skipped_names
    assert any(s["reason"] == "validation_failed" for s in body["skipped"])


def test_path_traversal_rejected(monkeypatch, cleanup_slugs):
    """A skill with '../etc/passwd' path is rejected."""
    slug = f"val-path-{uuid.uuid4().hex[:6]}"
    cleanup_slugs.append(slug)
    monkeypatch.setattr(
        "app.api.imports.inspect_source",
        _make_stub_inspect([
            {"name": "ok-skill", "description": "ok", "path": "skills/ok", "content_hash": "h1"},
            {"name": "evil", "description": "bad path", "path": "../etc/passwd", "content_hash": "h2"},
        ]),
    )
    r = client.post("/v1/import/apply", json={
        "input": "o/r",
        "target_collection_slug": slug,
        "on_conflict": "rename",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert {s["name"] for s in body["skipped"]} == {"evil"}


def test_all_invalid_aborts_with_422(monkeypatch, cleanup_slugs):
    """If every skill fails validation, the whole apply 422s with ALL_SKILLS_INVALID."""
    slug = f"val-all-{uuid.uuid4().hex[:6]}"
    cleanup_slugs.append(slug)
    monkeypatch.setattr(
        "app.api.imports.inspect_source",
        _make_stub_inspect([
            {"name": "claude-bad", "description": "reserved", "path": "skills/a", "content_hash": "h1"},
            {"name": "anthropic-bad", "description": "also reserved", "path": "skills/b", "content_hash": "h2"},
        ]),
    )
    r = client.post("/v1/import/apply", json={
        "input": "o/r",
        "target_collection_slug": slug,
        "on_conflict": "rename",
    })
    assert r.status_code == 422
    body = r.json()
    assert body["error"]["code"] == "ALL_SKILLS_INVALID"


def test_empty_skills_no_validation_error(monkeypatch, cleanup_slugs):
    """When inspector returns 0 skills, we still track the source — no validation fires."""
    slug = f"val-empty-{uuid.uuid4().hex[:6]}"
    cleanup_slugs.append(slug)
    monkeypatch.setattr(
        "app.api.imports.inspect_source",
        _make_stub_inspect([]),
    )
    r = client.post("/v1/import/apply", json={
        "input": "o/r",
        "target_collection_slug": slug,
        "on_conflict": "rename",
    })
    assert r.status_code == 201
    body = r.json()
    assert body["imported"] == []
    assert body["skipped"] == []
