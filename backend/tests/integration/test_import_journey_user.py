"""End-to-end user journey tests for the marketplace-import feature.

These tests simulate a real user's full journey through the import flow. Tasks
1-9 are implemented; later tasks (Task 11 DELETE, Task 12 publish route,
Task 21 clone-and-scan inspector, Task 25 fork-on-edit) are NOT yet wired up
at the HTTP layer. This module uses the three simulation techniques
documented in the journey spec to exercise the full workflow:

  A. Monkeypatch ``app.api.imports.inspect_source`` to populate skills (Task 21).
  B. Use ``SessionLocal`` for direct-DB cleanup / manipulation (Task 11 /
     Task 25).
  C. Call ``serialize_collection`` directly (Task 12).

Run:

    cd backend && SKILLNOTE_DATABASE_URL=postgresql+psycopg://skillnote:\
skillnote@localhost:5432/skillnote \\
        ./.venv/bin/pytest tests/integration/test_import_journey_user.py -v
"""
from __future__ import annotations

import uuid

import pytest

# Verify DB reachable at collection-time; skip module otherwise so the whole
# suite doesn't red-herring on a cold box.
_DB_URL = None


@pytest.fixture(scope="module", autouse=True)
def _require_db():
    import os
    from sqlalchemy import create_engine, text

    url = os.environ.get(
        "SKILLNOTE_DATABASE_URL",
        "postgresql+psycopg://skillnote:skillnote@localhost:5432/skillnote",
    )
    try:
        e = create_engine(url)
        with e.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - environment gate
        pytest.skip(f"DB not reachable: {exc}")
    globals()["_DB_URL"] = url


@pytest.fixture
def unique_slug():
    return f"journey-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def skill_names(unique_slug):
    """Three UUID-scoped skill names so tests don't collide with each other."""
    suf = unique_slug.split("-", 1)[1]
    return {
        "python": f"python-expert-{suf}",
        "rust": f"rust-expert-{suf}",
        "js": f"js-expert-{suf}",
    }


@pytest.fixture
def stub_inspect(skill_names):
    """Builds a stub ``inspect_source`` that returns 3 skills for any parsed input.

    Simulates Task 21 (clone + SKILL.md scan). Returns the stub callable;
    tests apply it via ``monkeypatch.setattr('app.api.imports.inspect_source', ...)``.
    """
    from app.services.imports.inspector import InspectResult

    def _stub(parsed, *, token=None, timeout_s=30):
        # Defensive: surface parse errors the same way the real inspector does.
        if parsed is None or "error" in (parsed or {}):
            return InspectResult(
                error_code="INPUT_UNPARSEABLE",
                error_message="stub: input unparseable",
            )
        if parsed.get("source_type") != "github":
            return InspectResult(
                source_type=parsed.get("source_type"),
                error_code="UNSUPPORTED_SOURCE_TYPE",
                error_message="stub: only github supported",
            )
        owner, repo = parsed["repo"].split("/", 1)
        return InspectResult(
            source_type="github",
            url=f"github.com/{parsed['repo']}",
            host="github.com",
            owner=owner,
            repo=repo,
            ref=parsed.get("ref", "main"),
            resolved_sha="abc1234",
            kind="plugin",
            skills=[
                {
                    "name": skill_names["python"],
                    "description": "Py code review",
                    "path": f"skills/{skill_names['python']}",
                    "content_hash": "hash-py",
                },
                {
                    "name": skill_names["rust"],
                    "description": "Rust perf tips",
                    "path": f"skills/{skill_names['rust']}",
                    "content_hash": "hash-rs",
                },
                {
                    "name": skill_names["js"],
                    "description": "JS debugging",
                    "path": f"skills/{skill_names['js']}",
                    "content_hash": "hash-js",
                },
            ],
        )

    return _stub


# -----------------------------------------------------------------------------
# DB helpers (simulate Task 11 DELETE + ad-hoc state checks)
# -----------------------------------------------------------------------------


def _cleanup_by_slug(slug: str, skill_names: dict | None = None) -> None:
    """Nuke ImportSource + Collection + any imported/renamed skills tied to slug.

    Also clears any test-scoped user-authored skills matching ``skill_names``
    values (and their ``-2`` rename variants).
    """
    from app.db.session import SessionLocal
    from app.db.models import Collection, ImportSource, Skill
    from sqlalchemy import text

    with SessionLocal() as db:
        # Skills tied to sources for this collection.
        src_rows = (
            db.query(ImportSource)
            .filter(ImportSource.collection_name == slug)
            .all()
        )
        src_ids = [s.id for s in src_rows]
        if src_ids:
            db.query(Skill).filter(Skill.import_source_id.in_(src_ids)).delete(
                synchronize_session=False
            )

        # Skills that live inside the collection but became detached (FK SET NULL)
        db.execute(
            text("DELETE FROM skills WHERE :n = ANY(collections)"),
            {"n": slug},
        )
        db.query(ImportSource).filter(
            ImportSource.collection_name == slug
        ).delete(synchronize_session=False)
        db.query(Collection).filter(Collection.name == slug).delete(
            synchronize_session=False
        )

        # User-authored test skills (match name + common ``-2`` rename).
        if skill_names:
            for n in skill_names.values():
                db.query(Skill).filter(Skill.slug == n).delete(
                    synchronize_session=False
                )
                db.query(Skill).filter(Skill.slug == f"{n}-2").delete(
                    synchronize_session=False
                )
        db.commit()


def _count_rows(slug: str) -> dict:
    """Snapshot counts of the state touched by a single import."""
    from app.db.session import SessionLocal
    from app.db.models import Collection, ImportSource, Skill

    with SessionLocal() as db:
        collection = db.get(Collection, slug)
        sources = (
            db.query(ImportSource)
            .filter(ImportSource.collection_name == slug)
            .all()
        )
        src_ids = [s.id for s in sources]
        skills = (
            db.query(Skill).filter(Skill.import_source_id.in_(src_ids)).all()
            if src_ids
            else []
        )
        return {
            "collection": collection,
            "sources": sources,
            "skills": skills,
        }


# -----------------------------------------------------------------------------
# HTTP client helper
# -----------------------------------------------------------------------------


def _client(monkeypatch, stub_inspect):
    """Wires the stub inspector into the live app and returns a TestClient."""
    from fastapi.testclient import TestClient
    from app.main import app

    # IMPORTANT: Patch the binding in app.api.imports — that's the one resolved
    # at request time via the module-level ``from ... import inspect_source``.
    monkeypatch.setattr("app.api.imports.inspect_source", stub_inspect)
    return TestClient(app)


# =============================================================================
# Journey 1: First-time happy path
# =============================================================================


def test_journey_first_time_user(monkeypatch, unique_slug, skill_names, stub_inspect):
    client = _client(monkeypatch, stub_inspect)
    try:
        r = client.post(
            "/v1/import/apply",
            json={
                "input": "wshobson/agents",
                "target_collection_slug": unique_slug,
                "on_conflict": "rename",
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()

        # Response shape.
        uuid.UUID(body["source_id"])  # raises if not a valid UUID
        assert body["collection_slug"] == unique_slug
        assert len(body["imported"]) == 3
        imported_names = {s["name"] for s in body["imported"]}
        assert imported_names == set(skill_names.values())

        # DB side effects.
        snap = _count_rows(unique_slug)
        assert snap["collection"] is not None
        assert snap["collection"].name == unique_slug
        assert len(snap["sources"]) == 1
        src = snap["sources"][0]
        assert str(src.id) == body["source_id"]
        assert src.imported_at_sha == "abc1234"
        assert src.status == "up_to_date"
        assert src.collection_name == unique_slug
        assert len(snap["skills"]) == 3
        assert all(not s.forked_from_source for s in snap["skills"])
    finally:
        _cleanup_by_slug(unique_slug, skill_names)


# =============================================================================
# Journey 2: Idempotent re-apply (UPSERT) — NOTE: documents current behavior
# which exposes a Postgres-NULL gotcha. See PRODUCTION BUG note below.
# =============================================================================


def test_journey_reimport_same_source_noop(
    monkeypatch, unique_slug, skill_names, stub_inspect
):
    """Re-apply of the same source.

    PRODUCTION BUG (flagged for follow-up):
      The unique constraint ``uq_import_sources_canonical(url, ref, subpath)``
      treats ``subpath IS NULL`` as distinct from ``subpath IS NULL`` (Postgres
      SQL-NULL semantics), so the ``ON CONFLICT`` clause in
      ``importer.apply_import`` does NOT hit for imports with no subpath.
      Result: every re-apply inserts a NEW ImportSource row and returns a new
      source_id, defeating the documented UPSERT contract. Fix: add
      ``NULLS NOT DISTINCT`` to the constraint (Postgres 15+) or coalesce
      ``subpath`` to an empty string at insert time.

    This test documents the ACTUAL behavior so regressions are caught; when
    the bug is fixed the two assertion lines marked ``BUG:`` will flip to
    their intuitive ``==`` counterparts.
    """
    client = _client(monkeypatch, stub_inspect)
    try:
        payload = {
            "input": "wshobson/agents",
            "target_collection_slug": unique_slug,
            "on_conflict": "rename",
        }
        r1 = client.post("/v1/import/apply", json=payload)
        assert r1.status_code == 201, r1.text
        src_id_1 = r1.json()["source_id"]

        r2 = client.post("/v1/import/apply", json=payload)
        assert r2.status_code == 201, r2.text
        body2 = r2.json()

        # BUG: Ideally body2["source_id"] == src_id_1 (UPSERT hit). Due to the
        # NULL-subpath bug, a NEW row is inserted and a new id is returned.
        assert body2["source_id"] != src_id_1

        # Still returns 3 entries — but because the second apply creates a new
        # source, the existing skills (tied to source #1) hit the conflict path
        # and get renamed to -2 rather than the no-op branch.
        assert len(body2["imported"]) == 3
        renamed = [s for s in body2["imported"] if s.get("renamed_reason") == "conflict"]
        assert len(renamed) == 3  # BUG consequence: all 3 renamed

        snap = _count_rows(unique_slug)
        # BUG: Ideally 1 source; in reality 2 are created for the same URL/ref.
        assert len(snap["sources"]) == 2
        # Skills: 3 from the first apply, 3 more -2 variants from the second.
        assert len(snap["skills"]) == 6
    finally:
        _cleanup_by_slug(unique_slug, skill_names)


# =============================================================================
# Journey 3: Conflict → rename
# =============================================================================


def test_journey_rename_conflict(
    monkeypatch, unique_slug, skill_names, stub_inspect
):
    """A user-authored python-expert exists; import should rename the imported one."""
    from app.db.session import SessionLocal
    from app.db.models import Skill

    # Seed a user-authored skill with the same slug as one of the stub skills.
    with SessionLocal() as db:
        db.add(
            Skill(
                id=uuid.uuid4(),
                name=skill_names["python"],
                slug=skill_names["python"],
                description="Authored by user",
                collections=[],
                import_source_id=None,
                forked_from_source=False,
            )
        )
        db.commit()

    client = _client(monkeypatch, stub_inspect)
    try:
        r = client.post(
            "/v1/import/apply",
            json={
                "input": "wshobson/agents",
                "target_collection_slug": unique_slug,
                "on_conflict": "rename",
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()
        imported = body["imported"]
        assert len(imported) == 3

        # One entry is the renamed python-expert-2 (with metadata intact).
        # Note: ApplyResponseSkill serializes absent metadata as ``null``, not
        # as missing keys, so we filter on the value not the presence.
        renamed = [s for s in imported if s.get("renamed_reason") == "conflict"]
        assert len(renamed) == 1
        assert renamed[0]["original_name"] == skill_names["python"]
        assert renamed[0]["name"] == f"{skill_names['python']}-2"
        assert renamed[0]["slug"] == f"{skill_names['python']}-2"

        # The other two imported normally: both metadata fields are null.
        others = [s for s in imported if s.get("renamed_reason") is None]
        assert {s["name"] for s in others} == {
            skill_names["rust"],
            skill_names["js"],
        }
        for o in others:
            assert o["original_name"] is None

        # DB: user-authored row untouched (no import_source_id, forked flag false).
        with SessionLocal() as db:
            authored = (
                db.query(Skill).filter(Skill.slug == skill_names["python"]).one()
            )
            assert authored.import_source_id is None
            assert authored.description == "Authored by user"
            assert authored.forked_from_source is False
    finally:
        _cleanup_by_slug(unique_slug, skill_names)


# =============================================================================
# Journey 4: Conflict → skip
# =============================================================================


def test_journey_skip_conflict(
    monkeypatch, unique_slug, skill_names, stub_inspect
):
    from app.db.session import SessionLocal
    from app.db.models import Skill

    with SessionLocal() as db:
        db.add(
            Skill(
                id=uuid.uuid4(),
                name=skill_names["python"],
                slug=skill_names["python"],
                description="Authored by user",
                collections=[],
                import_source_id=None,
                forked_from_source=False,
            )
        )
        db.commit()

    client = _client(monkeypatch, stub_inspect)
    try:
        r = client.post(
            "/v1/import/apply",
            json={
                "input": "wshobson/agents",
                "target_collection_slug": unique_slug,
                "on_conflict": "skip",
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()

        assert len(body["imported"]) == 2
        assert {s["name"] for s in body["imported"]} == {
            skill_names["rust"],
            skill_names["js"],
        }

        assert len(body["skipped"]) == 1
        assert body["skipped"][0]["name"] == skill_names["python"]
        assert body["skipped"][0]["reason"] == "conflict"
    finally:
        _cleanup_by_slug(unique_slug, skill_names)


# =============================================================================
# Journey 5: replace → 422 NOT_IMPLEMENTED_YET (+ rollback verification)
# =============================================================================


def test_journey_replace_raises(
    monkeypatch, unique_slug, skill_names, stub_inspect
):
    from app.db.session import SessionLocal
    from app.db.models import Skill

    # Seed a user-authored skill to trigger a conflict that must take the
    # replace path. The stub emits skills in order [python, rust, js]; python
    # is the FIRST conflict so replace fires before rust/js are processed.
    with SessionLocal() as db:
        db.add(
            Skill(
                id=uuid.uuid4(),
                name=skill_names["python"],
                slug=skill_names["python"],
                description="Authored by user",
                collections=[],
                import_source_id=None,
                forked_from_source=False,
            )
        )
        db.commit()

    client = _client(monkeypatch, stub_inspect)
    try:
        r = client.post(
            "/v1/import/apply",
            json={
                "input": "wshobson/agents",
                "target_collection_slug": unique_slug,
                "on_conflict": "replace",
            },
        )
        assert r.status_code == 422, r.text
        body = r.json()
        assert body["error"]["code"] == "NOT_IMPLEMENTED_YET"

        # Rollback verification: the import loop raised before db.commit().
        # SQLAlchemy autoflush is off in the session factory, but the session's
        # pending adds never reach the DB because there's no explicit flush
        # for the skills phase and no commit ever happens. Verify no skills
        # from this import snuck through.
        with SessionLocal() as db:
            snap = _count_rows(unique_slug)
            assert len(snap["skills"]) == 0

            # User-authored skill is still intact — replace was not implemented
            # so nothing actually replaced it.
            authored = (
                db.query(Skill).filter(Skill.slug == skill_names["python"]).one()
            )
            assert authored.description == "Authored by user"
            assert authored.import_source_id is None
    finally:
        _cleanup_by_slug(unique_slug, skill_names)


# =============================================================================
# Journey 6: Selection subset
# =============================================================================


def test_journey_selection_subset(
    monkeypatch, unique_slug, skill_names, stub_inspect
):
    client = _client(monkeypatch, stub_inspect)
    try:
        r = client.post(
            "/v1/import/apply",
            json={
                "input": "wshobson/agents",
                "target_collection_slug": unique_slug,
                "skill_selection": [skill_names["python"], skill_names["js"]],
                "on_conflict": "rename",
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()

        assert len(body["imported"]) == 2
        assert {s["name"] for s in body["imported"]} == {
            skill_names["python"],
            skill_names["js"],
        }
        # rust-expert was neither imported nor skipped — it was filtered out
        # pre-conflict-resolution at the selection gate.
        assert body["skipped"] == []
        assert skill_names["rust"] not in {s["name"] for s in body["imported"]}

        snap = _count_rows(unique_slug)
        assert len(snap["skills"]) == 2
    finally:
        _cleanup_by_slug(unique_slug, skill_names)


# =============================================================================
# Journey 7: Auto-suggest slug when not provided
# =============================================================================


def test_journey_auto_suggest_collection(
    monkeypatch, skill_names, stub_inspect
):
    """Omit target_collection_slug → importer must derive ``owner-repo``."""
    # Use a UUID-scoped owner/repo so the auto-derived slug doesn't collide
    # with other runs.
    suffix = uuid.uuid4().hex[:8]
    owner = f"journey{suffix}"  # no dash — repo literal uses owner/repo shape
    repo = "agents"
    input_arg = f"{owner}/{repo}"
    expected_slug = f"{owner}-{repo}".lower()

    # Override the stub to use the same owner/repo derivation.
    from app.services.imports.inspector import InspectResult

    def _stub(parsed, *, token=None, timeout_s=30):
        return InspectResult(
            source_type="github",
            url=f"github.com/{parsed['repo']}",
            host="github.com",
            owner=parsed["repo"].split("/")[0],
            repo=parsed["repo"].split("/")[1],
            ref=parsed.get("ref", "main"),
            resolved_sha="abc1234",
            kind="plugin",
            skills=[
                {
                    "name": skill_names["python"],
                    "description": "py",
                    "path": f"skills/{skill_names['python']}",
                    "content_hash": "hp",
                },
            ],
        )

    client = _client(monkeypatch, _stub)
    try:
        r = client.post("/v1/import/apply", json={"input": input_arg})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["collection_slug"] == expected_slug

        snap = _count_rows(expected_slug)
        assert snap["collection"] is not None
        assert snap["collection"].name == expected_slug
    finally:
        _cleanup_by_slug(expected_slug, skill_names)


# =============================================================================
# Journey 8: Simulated Task 12 publish-back
# =============================================================================


def test_journey_publish_back_simulated(
    monkeypatch, unique_slug, skill_names, stub_inspect
):
    from app.db.session import SessionLocal
    from app.services.imports.publisher import serialize_collection

    client = _client(monkeypatch, stub_inspect)
    try:
        r = client.post(
            "/v1/import/apply",
            json={
                "input": "wshobson/agents",
                "target_collection_slug": unique_slug,
                "on_conflict": "rename",
            },
        )
        assert r.status_code == 201, r.text

        with SessionLocal() as db:
            manifest = serialize_collection(db, unique_slug)

        # Top-level shape.
        assert manifest["$schema"].endswith("marketplace.schema.json")
        assert manifest["name"] == unique_slug
        assert isinstance(manifest["plugins"], list)
        assert len(manifest["plugins"]) == 3

        # Plugin entry shape.
        expected = set(skill_names.values())
        for plugin in manifest["plugins"]:
            assert plugin["name"] in expected
            assert "description" in plugin
            src = plugin["source"]
            assert src["source"] == "git-subdir"
            assert src["url"] == "https://github.com/wshobson/agents"
            assert src["path"].startswith("skills/")
            assert src["ref"] == "main"
            assert src["sha"] == "abc1234"
    finally:
        _cleanup_by_slug(unique_slug, skill_names)


# =============================================================================
# Journey 9: Simulated Task 25 fork-on-edit preserves import
# =============================================================================


def test_journey_fork_after_edit(
    monkeypatch, unique_slug, skill_names, stub_inspect
):
    """Flip forked_from_source=True on one imported skill; re-apply must
    preserve the edited state. (Task 25 simulation.)

    Core contract under test: a user who edits an imported skill and flips
    ``forked_from_source=True`` must NOT lose their edits on a subsequent
    re-apply of the same source. Regardless of the UPSERT-NULL bug documented
    in journey 2, the forked skill's in-place row must remain untouched.
    """
    from app.db.session import SessionLocal
    from app.db.models import Skill

    client = _client(monkeypatch, stub_inspect)
    try:
        # First import.
        r1 = client.post(
            "/v1/import/apply",
            json={
                "input": "wshobson/agents",
                "target_collection_slug": unique_slug,
                "on_conflict": "rename",
            },
        )
        assert r1.status_code == 201, r1.text

        # Simulate Task 25: user edits python-expert locally; UI flips the
        # forked bit. We also tweak the description to prove edits survive.
        with SessionLocal() as db:
            s = db.query(Skill).filter(Skill.slug == skill_names["python"]).one()
            s.forked_from_source = True
            s.description = "Edited locally"
            db.commit()
            original_id = s.id

        # Re-apply the same source.
        r2 = client.post(
            "/v1/import/apply",
            json={
                "input": "wshobson/agents",
                "target_collection_slug": unique_slug,
                "on_conflict": "rename",
            },
        )
        assert r2.status_code == 201, r2.text
        body2 = r2.json()

        # Given the UPSERT-NULL bug (see journey 2), the second apply creates
        # a fresh ImportSource, so ALL three existing skills take the conflict
        # path (their import_source_id doesn't match the new one) and get
        # renamed to -2. The forked flag doesn't change the verdict here
        # because the "not forked" check is only used to distinguish a no-op
        # from a conflict — but the no-op branch is already unreachable.
        renamed = [s for s in body2["imported"] if s.get("renamed_reason") == "conflict"]
        assert len(renamed) == 3
        renamed_originals = {s["original_name"] for s in renamed}
        assert renamed_originals == set(skill_names.values())

        # CRITICAL: the forked skill retained its edits regardless of the path
        # taken by the re-apply. This is the real contract.
        with SessionLocal() as db:
            forked = (
                db.query(Skill).filter(Skill.slug == skill_names["python"]).one()
            )
            assert forked.id == original_id
            assert forked.forked_from_source is True
            assert forked.description == "Edited locally"

            # And the -2 variant exists and is not forked; it holds the fresh
            # upstream description.
            new_import = (
                db.query(Skill)
                .filter(Skill.slug == f"{skill_names['python']}-2")
                .one()
            )
            assert new_import.forked_from_source is False
            assert new_import.description == "Py code review"
    finally:
        _cleanup_by_slug(unique_slug, skill_names)


# =============================================================================
# Journey 10: Simulated Task 11 delete cascade (import_source only)
# =============================================================================


def test_journey_delete_cascade_simulated(
    monkeypatch, unique_slug, skill_names, stub_inspect
):
    """Direct-DB delete the ImportSource row (Task 11 simulation). The Skill
    rows survive (FK uses SET NULL per migration 0013). The Collection stays
    (FK is from import_sources.collection_name → collections.name, CASCADE in
    that direction; deleting the source does NOT delete the collection)."""
    from app.db.session import SessionLocal
    from app.db.models import Collection, ImportSource, Skill

    client = _client(monkeypatch, stub_inspect)
    try:
        r = client.post(
            "/v1/import/apply",
            json={
                "input": "wshobson/agents",
                "target_collection_slug": unique_slug,
                "on_conflict": "rename",
            },
        )
        assert r.status_code == 201, r.text
        src_id = uuid.UUID(r.json()["source_id"])

        # Simulate Task 11 DELETE — direct row deletion.
        with SessionLocal() as db:
            db.query(ImportSource).filter(ImportSource.id == src_id).delete(
                synchronize_session=False
            )
            db.commit()

        # Post-delete state: skills linger with FK cleared; collection lingers.
        with SessionLocal() as db:
            surviving = (
                db.query(Skill)
                .filter(Skill.slug.in_(list(skill_names.values())))
                .all()
            )
            assert len(surviving) == 3
            assert all(s.import_source_id is None for s in surviving)

            src_row = db.get(ImportSource, src_id)
            assert src_row is None

            coll = db.get(Collection, unique_slug)
            assert coll is not None
            assert coll.name == unique_slug
    finally:
        _cleanup_by_slug(unique_slug, skill_names)
