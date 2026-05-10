"""Deep-focus integration tests for UPSERT + conflict-resolution logic
in /v1/import/apply.

Covers every realistic multi-import combination:

* UPSERT on (url, ref, subpath) — Tests 1-4
* Rename chain / numbering — Tests 5, 6
* on_conflict=skip bookkeeping — Test 7
* on_conflict=replace rolls back — Test 8
* Same-source re-apply: no-op vs. content_hash drift — Tests 9, 10
* Forked skills treated as conflicts — Test 11
* skill_selection gating (excluded != skipped) — Test 12

The endpoint resolves ``inspect_source`` at module level in
``app.api.imports``; we monkeypatch THAT binding (not the inspector
module) so apply_import sees our controlled stub.

PRODUCTION BUG (also documented in test_import_journey_user.py):
    The unique constraint ``uq_import_sources_canonical(url, ref, subpath)``
    treats ``subpath IS NULL`` as DISTINCT from another ``subpath IS NULL``
    (Postgres default NULLS DISTINCT semantics). So the ``ON CONFLICT`` clause
    in ``importer.apply_import`` does NOT fire when the user imports without a
    subpath (the common case — plain ``owner/repo`` inputs). Every re-apply
    inserts a fresh ImportSource row and returns a new source_id, defeating
    the documented UPSERT contract. Fix: add ``NULLS NOT DISTINCT`` to the
    unique constraint (Postgres 15+) or coalesce ``subpath`` to ``''`` at
    insert time.

    Tests that directly depend on UPSERT-dedup semantics for NULL subpaths
    are marked ``xfail(strict=True)`` so they flip to PASS automatically
    once the bug is fixed (and the xfail markers can then be removed).

Run:

    cd backend && SKILLNOTE_DATABASE_URL=\
postgresql+psycopg://skillnote:skillnote@localhost:5432/skillnote \
        ./.venv/bin/pytest tests/integration/test_import_conflict_matrix.py -v
"""
from __future__ import annotations

import uuid

import pytest


# ---------------------------------------------------------------------------
# Module-scoped DB gate: skip everything if Postgres is unreachable.
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Cleanup helper. Each test registers what it creates, gets nuked on teardown.
# ---------------------------------------------------------------------------


@pytest.fixture
def cleanup():
    """Returns (track_collection, track_source, track_skill) tuple.

    On teardown, deletes any skills by slug, import_sources by id, and
    collections by name that were tracked. Deletion order is:
    skills -> sources -> collections (FK order matters).
    """
    created = {"collections": set(), "sources": set(), "skills": set()}

    def _track_collection(name: str) -> None:
        created["collections"].add(name)

    def _track_source(sid) -> None:
        created["sources"].add(str(sid))

    def _track_skill(slug: str) -> None:
        created["skills"].add(slug)

    yield _track_collection, _track_source, _track_skill

    from app.db.session import SessionLocal
    from app.db.models import Collection, ImportSource, Skill

    with SessionLocal() as db:
        for slug in created["skills"]:
            db.query(Skill).filter(Skill.slug == slug).delete(
                synchronize_session=False
            )
        # Also nuke any source-owned skills (rename/replace may create new
        # slugs we didn't explicitly register).
        for sid in created["sources"]:
            db.query(Skill).filter(
                Skill.import_source_id == uuid.UUID(sid)
            ).delete(synchronize_session=False)
            db.query(ImportSource).filter(
                ImportSource.id == uuid.UUID(sid)
            ).delete(synchronize_session=False)
        for name in created["collections"]:
            # Sources ride on the collection FK; delete any stragglers first.
            db.query(ImportSource).filter(
                ImportSource.collection_name == name
            ).delete(synchronize_session=False)
            db.query(Collection).filter(Collection.name == name).delete(
                synchronize_session=False
            )
        db.commit()


@pytest.fixture
def slug():
    return f"conflict-test-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def names(slug):
    """UUID-scoped skill names so tests don't collide."""
    suf = slug.split("-", 2)[-1]
    return {
        "python": f"python-expert-{suf}",
        "rust": f"rust-expert-{suf}",
        "js": f"js-expert-{suf}",
    }


# ---------------------------------------------------------------------------
# Stub inspect builder. Skills, SHA, and subpath are parametrizable.
# ---------------------------------------------------------------------------


def _make_stub_inspect(skills, *, sha="abc1234", subpath=None):
    """Build an inspect_source stub that returns the given skills and SHA.

    Honors the request's `ref` so tests can differentiate refs without
    spinning up multiple stubs.
    """
    from app.services.imports.inspector import InspectResult

    def _stub(parsed, *, token=None, timeout_s=30):
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
        # Subpath preference: explicit stub arg wins, else honor parsed.
        effective_subpath = subpath if subpath is not None else parsed.get("subpath")
        return InspectResult(
            source_type="github",
            url=f"github.com/{parsed['repo']}",
            host="github.com",
            owner=owner,
            repo=repo,
            ref=parsed.get("ref", "main"),
            resolved_sha=sha,
            subpath=effective_subpath,
            kind="plugin",
            skills=list(skills),
        )

    return _stub


def _client(monkeypatch, stub):
    """Install stub into app.api.imports and return a TestClient."""
    from fastapi.testclient import TestClient
    from app.main import app

    # Patch the binding in app.api.imports — that's the one resolved at
    # request time by `from ... import inspect_source`. Patching the
    # inspector module directly would NOT intercept.
    monkeypatch.setattr("app.api.imports.inspect_source", stub)
    return TestClient(app)


def _get_session():
    """Shorthand for tests that need direct DB reads."""
    from app.db.session import SessionLocal

    return SessionLocal()


# ===========================================================================
# TESTS
# ===========================================================================


# ----- UPSERT (import_sources) ---------------------------------------------


@pytest.mark.xfail(
    strict=True,
    reason=(
        "PRODUCTION BUG: uq_import_sources_canonical uses default NULLS "
        "DISTINCT semantics, so the ON CONFLICT clause never matches when "
        "subpath IS NULL. Re-apply of plain 'owner/repo' creates a new row."
    ),
)
def test_upsert_same_input_returns_same_source_id(monkeypatch, slug, names, cleanup):
    """Re-applying the same (url, ref, subpath) must reuse the source row."""
    track_col, track_src, _ = cleanup
    track_col(slug)

    stub = _make_stub_inspect(
        [
            {"name": names["python"], "description": "py", "path": "p", "content_hash": "h1"},
            {"name": names["rust"], "description": "rs", "path": "r", "content_hash": "h2"},
            {"name": names["js"], "description": "js", "path": "j", "content_hash": "h3"},
        ]
    )
    client = _client(monkeypatch, stub)

    payload = {
        "input": "owner/repo",
        "target_collection_slug": slug,
        "on_conflict": "rename",
    }
    r1 = client.post("/v1/import/apply", json=payload)
    assert r1.status_code == 201, r1.text
    body1 = r1.json()
    track_src(body1["source_id"])

    r2 = client.post("/v1/import/apply", json=payload)
    assert r2.status_code == 201, r2.text
    body2 = r2.json()

    # Identical source_id on both applies.
    assert body1["source_id"] == body2["source_id"]

    # Exactly one row in import_sources for this canonical (url, ref, subpath).
    from app.db.models import ImportSource
    with _get_session() as db:
        rows = (
            db.query(ImportSource)
            .filter(ImportSource.url == "github.com/owner/repo")
            .filter(ImportSource.ref == "main")
            .all()
        )
        assert len(rows) == 1
        assert str(rows[0].id) == body1["source_id"]


@pytest.mark.xfail(
    strict=True,
    reason=(
        "PRODUCTION BUG: UPSERT doesn't match on NULL subpath, so the second "
        "apply inserts a NEW row instead of refreshing imported_at_sha on the "
        "existing row. Once the NULLS NOT DISTINCT fix lands, the UPDATE path "
        "runs and this test will pass."
    ),
)
def test_upsert_refreshes_imported_at_sha(monkeypatch, slug, names, cleanup):
    """Second apply with a new SHA should refresh imported_at_sha and last_synced_at."""
    track_col, track_src, _ = cleanup
    track_col(slug)

    stub1 = _make_stub_inspect(
        [{"name": names["python"], "description": "p", "path": "p", "content_hash": "h"}],
        sha="abc1234",
    )
    client = _client(monkeypatch, stub1)
    r1 = client.post(
        "/v1/import/apply",
        json={
            "input": "owner/repo",
            "target_collection_slug": slug,
            "on_conflict": "rename",
        },
    )
    assert r1.status_code == 201, r1.text
    src_id = r1.json()["source_id"]
    track_src(src_id)

    from app.db.models import ImportSource
    with _get_session() as db:
        row_before = db.get(ImportSource, uuid.UUID(src_id))
        assert row_before is not None
        assert row_before.imported_at_sha == "abc1234"
        assert row_before.upstream_sha == "abc1234"
        ts_before = row_before.last_synced_at

    # Swap stub to a new SHA and re-apply.
    stub2 = _make_stub_inspect(
        [{"name": names["python"], "description": "p", "path": "p", "content_hash": "h"}],
        sha="deadbeef",
    )
    monkeypatch.setattr("app.api.imports.inspect_source", stub2)
    r2 = client.post(
        "/v1/import/apply",
        json={
            "input": "owner/repo",
            "target_collection_slug": slug,
            "on_conflict": "rename",
        },
    )
    assert r2.status_code == 201, r2.text
    assert r2.json()["source_id"] == src_id  # UPSERT returned same id

    with _get_session() as db:
        row_after = db.get(ImportSource, uuid.UUID(src_id))
        assert row_after.imported_at_sha == "deadbeef"
        assert row_after.upstream_sha == "deadbeef"
        # last_synced_at should have advanced (or at least not regressed).
        assert row_after.last_synced_at >= ts_before
        assert row_after.status == "up_to_date"
        assert row_after.last_error is None


def test_upsert_different_ref_creates_new_source(monkeypatch, slug, names, cleanup):
    """Same url + subpath but different ref => distinct ImportSource row."""
    track_col, track_src, _ = cleanup
    track_col(slug)

    stub = _make_stub_inspect(
        [{"name": names["python"], "description": "p", "path": "p", "content_hash": "h"}]
    )
    client = _client(monkeypatch, stub)

    r1 = client.post(
        "/v1/import/apply",
        json={
            "input": "owner/repo@main",
            "target_collection_slug": slug,
            "on_conflict": "rename",
        },
    )
    assert r1.status_code == 201, r1.text
    sid_main = r1.json()["source_id"]
    track_src(sid_main)

    r2 = client.post(
        "/v1/import/apply",
        json={
            "input": "owner/repo@develop",
            "target_collection_slug": slug,
            "on_conflict": "rename",
        },
    )
    assert r2.status_code == 201, r2.text
    sid_dev = r2.json()["source_id"]
    track_src(sid_dev)

    assert sid_main != sid_dev

    from app.db.models import ImportSource
    with _get_session() as db:
        rows = (
            db.query(ImportSource)
            .filter(ImportSource.url == "github.com/owner/repo")
            .order_by(ImportSource.ref)
            .all()
        )
        refs = sorted(r.ref for r in rows)
        assert refs == ["develop", "main"]
        assert len(rows) == 2


def test_upsert_different_subpath_creates_new_source(monkeypatch, slug, names, cleanup):
    """Same url + ref but different subpath => distinct ImportSource row."""
    track_col, track_src, _ = cleanup
    track_col(slug)

    # First apply: subpath="skills".
    stub_a = _make_stub_inspect(
        [{"name": names["python"], "description": "p", "path": "p", "content_hash": "h"}],
        subpath="skills",
    )
    client = _client(monkeypatch, stub_a)
    r1 = client.post(
        "/v1/import/apply",
        json={
            "input": "owner/repo",
            "subpath": "skills",
            "target_collection_slug": slug,
            "on_conflict": "rename",
        },
    )
    assert r1.status_code == 201, r1.text
    sid_a = r1.json()["source_id"]
    track_src(sid_a)

    # Second apply: subpath="plugins". Use a differently-named skill to avoid
    # a cross-source same-slug conflict muddying the UPSERT check.
    stub_b = _make_stub_inspect(
        [{"name": names["rust"], "description": "r", "path": "r", "content_hash": "h"}],
        subpath="plugins",
    )
    monkeypatch.setattr("app.api.imports.inspect_source", stub_b)
    r2 = client.post(
        "/v1/import/apply",
        json={
            "input": "owner/repo",
            "subpath": "plugins",
            "target_collection_slug": slug,
            "on_conflict": "rename",
        },
    )
    assert r2.status_code == 201, r2.text
    sid_b = r2.json()["source_id"]
    track_src(sid_b)

    assert sid_a != sid_b

    from app.db.models import ImportSource
    with _get_session() as db:
        rows = (
            db.query(ImportSource)
            .filter(ImportSource.url == "github.com/owner/repo")
            .filter(ImportSource.ref == "main")
            .order_by(ImportSource.subpath)
            .all()
        )
        assert len(rows) == 2
        subpaths = sorted(r.subpath for r in rows)
        assert subpaths == ["plugins", "skills"]


# ----- Rename chain ---------------------------------------------------------


def test_conflict_rename_chain_three_levels(monkeypatch, slug, names, cleanup):
    """Pre-existing `base` and `base-2` -> new import gets `base-3`."""
    track_col, track_src, track_skill = cleanup
    track_col(slug)

    base = names["python"]
    already_two = f"{base}-2"

    from app.db.models import Skill
    with _get_session() as db:
        for n in (base, already_two):
            db.add(
                Skill(
                    id=uuid.uuid4(),
                    name=n,
                    slug=n,
                    description="user-authored",
                    collections=[],
                    import_source_id=None,
                    forked_from_source=False,
                )
            )
        db.commit()
    track_skill(base)
    track_skill(already_two)

    stub = _make_stub_inspect(
        [{"name": base, "description": "imp", "path": "p", "content_hash": "h"}]
    )
    client = _client(monkeypatch, stub)
    r = client.post(
        "/v1/import/apply",
        json={
            "input": "owner/repo",
            "target_collection_slug": slug,
            "on_conflict": "rename",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    track_src(body["source_id"])

    assert len(body["imported"]) == 1
    entry = body["imported"][0]
    expected = f"{base}-3"
    assert entry["name"] == expected
    assert entry["slug"] == expected
    assert entry["original_name"] == base
    assert entry["renamed_reason"] == "conflict"
    track_skill(expected)

    # Confirm DB has all three: base (user), base-2 (user), base-3 (imported).
    with _get_session() as db:
        slugs = {
            r[0]
            for r in db.query(Skill.slug)
            .filter(Skill.slug.in_([base, already_two, expected]))
            .all()
        }
        assert slugs == {base, already_two, expected}


def test_conflict_rename_increments_from_2(monkeypatch, slug, names, cleanup):
    """Rename starts at `-2`, never `-1`."""
    track_col, track_src, track_skill = cleanup
    track_col(slug)

    base = names["python"]

    from app.db.models import Skill
    with _get_session() as db:
        db.add(
            Skill(
                id=uuid.uuid4(),
                name=base,
                slug=base,
                description="user",
                collections=[],
                import_source_id=None,
                forked_from_source=False,
            )
        )
        db.commit()
    track_skill(base)

    stub = _make_stub_inspect(
        [{"name": base, "description": "imp", "path": "p", "content_hash": "h"}]
    )
    client = _client(monkeypatch, stub)
    r = client.post(
        "/v1/import/apply",
        json={
            "input": "owner/repo",
            "target_collection_slug": slug,
            "on_conflict": "rename",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    track_src(body["source_id"])

    assert len(body["imported"]) == 1
    assert body["imported"][0]["name"] == f"{base}-2"
    track_skill(f"{base}-2")

    # Defensively: no -1 exists anywhere.
    with _get_session() as db:
        hit = db.query(Skill).filter(Skill.slug == f"{base}-1").first()
        assert hit is None


# ----- Skip path ------------------------------------------------------------


def test_conflict_skip_populates_skipped_list(monkeypatch, slug, names, cleanup):
    """`on_conflict=skip`: conflicting skill goes to skipped[], others import."""
    track_col, track_src, track_skill = cleanup
    track_col(slug)

    from app.db.models import Skill
    with _get_session() as db:
        db.add(
            Skill(
                id=uuid.uuid4(),
                name=names["python"],
                slug=names["python"],
                description="user",
                collections=[],
                import_source_id=None,
                forked_from_source=False,
            )
        )
        db.commit()
    track_skill(names["python"])

    stub = _make_stub_inspect(
        [
            {"name": names["python"], "description": "p", "path": "p", "content_hash": "h"},
            {"name": names["rust"], "description": "r", "path": "r", "content_hash": "h"},
            {"name": names["js"], "description": "j", "path": "j", "content_hash": "h"},
        ]
    )
    client = _client(monkeypatch, stub)
    r = client.post(
        "/v1/import/apply",
        json={
            "input": "owner/repo",
            "target_collection_slug": slug,
            "on_conflict": "skip",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    track_src(body["source_id"])
    track_skill(names["rust"])
    track_skill(names["js"])

    imported_names = {s["name"] for s in body["imported"]}
    assert imported_names == {names["rust"], names["js"]}
    assert len(body["imported"]) == 2

    assert len(body["skipped"]) == 1
    assert body["skipped"][0] == {
        "name": names["python"],
        "reason": "conflict",
    }

    # DB check: user-authored python-expert untouched, no new row for it.
    with _get_session() as db:
        rows = db.query(Skill).filter(Skill.slug == names["python"]).all()
        assert len(rows) == 1
        assert rows[0].import_source_id is None  # still user-authored


# ----- Replace (NOT_IMPLEMENTED_YET) ---------------------------------------


def test_conflict_replace_raises_422(monkeypatch, slug, names, cleanup):
    """`on_conflict=replace` 422s AND rolls back the entire transaction."""
    track_col, track_src, track_skill = cleanup
    track_col(slug)

    from app.db.models import Collection, ImportSource, Skill

    with _get_session() as db:
        db.add(
            Skill(
                id=uuid.uuid4(),
                name=names["python"],
                slug=names["python"],
                description="user",
                collections=[],
                import_source_id=None,
                forked_from_source=False,
            )
        )
        db.commit()
    track_skill(names["python"])

    stub = _make_stub_inspect(
        [
            {"name": names["python"], "description": "p", "path": "p", "content_hash": "h"},
            {"name": names["rust"], "description": "r", "path": "r", "content_hash": "h"},
        ]
    )
    client = _client(monkeypatch, stub)
    r = client.post(
        "/v1/import/apply",
        json={
            "input": "owner/repo",
            "target_collection_slug": slug,
            "on_conflict": "replace",
        },
    )
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["error"]["code"] == "NOT_IMPLEMENTED_YET"
    # Message mentions rename/skip as alternatives.
    assert "replace" in body["error"]["message"].lower()

    # Transactional safety: NOTHING committed from this request.
    with _get_session() as db:
        # ImportSource row with our canonical URL should NOT exist.
        src_rows = (
            db.query(ImportSource)
            .filter(ImportSource.url == "github.com/owner/repo")
            .filter(ImportSource.collection_name == slug)
            .all()
        )
        assert src_rows == []

        # Collection row was added+flushed but NOT committed; must be absent.
        col = db.get(Collection, slug)
        assert col is None

        # The pre-existing user-authored skill must be untouched.
        user_skill = (
            db.query(Skill).filter(Skill.slug == names["python"]).one()
        )
        assert user_skill.description == "user"
        assert user_skill.import_source_id is None

        # No skills from this import got in.
        rust_rows = db.query(Skill).filter(Skill.slug == names["rust"]).all()
        assert rust_rows == []


# ----- Same-source re-apply -------------------------------------------------


def test_same_source_reapply_skill_unchanged_no_op(monkeypatch, slug, names, cleanup):
    """Re-apply same source + same content_hash: skill row untouched but still in imported[]."""
    track_col, track_src, track_skill = cleanup
    track_col(slug)
    track_skill(names["python"])

    stub = _make_stub_inspect(
        [
            {
                "name": names["python"],
                "description": "original desc",
                "path": "p",
                "content_hash": "H1",
            }
        ]
    )
    client = _client(monkeypatch, stub)

    payload = {
        "input": "owner/repo",
        "target_collection_slug": slug,
        "on_conflict": "rename",
    }
    r1 = client.post("/v1/import/apply", json=payload)
    assert r1.status_code == 201, r1.text
    body1 = r1.json()
    track_src(body1["source_id"])
    assert len(body1["imported"]) == 1

    from app.db.models import Skill
    with _get_session() as db:
        s_before = (
            db.query(Skill).filter(Skill.slug == names["python"]).one()
        )
        before_desc = s_before.description
        before_hash = s_before.source_content_hash
        before_sha = s_before.source_sha
        before_updated = s_before.updated_at
        assert before_desc == "original desc"
        assert before_hash == "H1"

    # Second apply: identical data, identical content_hash.
    r2 = client.post("/v1/import/apply", json=payload)
    assert r2.status_code == 201, r2.text
    body2 = r2.json()
    assert body2["source_id"] == body1["source_id"]
    # Per spec: same-source no-op still counts as imported.
    assert len(body2["imported"]) == 1
    assert body2["imported"][0]["name"] == names["python"]
    # And no rename metadata.
    assert body2["imported"][0].get("original_name") is None

    with _get_session() as db:
        s_after = (
            db.query(Skill).filter(Skill.slug == names["python"]).one()
        )
        # No-op branch: description / content_hash / source_sha untouched.
        assert s_after.description == before_desc
        assert s_after.source_content_hash == before_hash
        assert s_after.source_sha == before_sha


def test_same_source_reapply_content_hash_changed_updates(monkeypatch, slug, names, cleanup):
    """Re-apply same source with a different content_hash: description + hash + sha refresh."""
    track_col, track_src, track_skill = cleanup
    track_col(slug)
    track_skill(names["python"])

    # First apply: content_hash=H1, sha=abc1234.
    stub1 = _make_stub_inspect(
        [
            {
                "name": names["python"],
                "description": "first description",
                "path": "p",
                "content_hash": "H1",
            }
        ],
        sha="abc1234",
    )
    client = _client(monkeypatch, stub1)
    payload = {
        "input": "owner/repo",
        "target_collection_slug": slug,
        "on_conflict": "rename",
    }
    r1 = client.post("/v1/import/apply", json=payload)
    assert r1.status_code == 201, r1.text
    body1 = r1.json()
    track_src(body1["source_id"])

    from app.db.models import Skill
    with _get_session() as db:
        s = db.query(Skill).filter(Skill.slug == names["python"]).one()
        assert s.source_content_hash == "H1"
        assert s.source_sha == "abc1234"
        assert s.description == "first description"

    # Second apply: same skill name, new content_hash=H2, new sha.
    stub2 = _make_stub_inspect(
        [
            {
                "name": names["python"],
                "description": "updated description",
                "path": "p",
                "content_hash": "H2",
            }
        ],
        sha="deadbeef",
    )
    monkeypatch.setattr("app.api.imports.inspect_source", stub2)
    r2 = client.post("/v1/import/apply", json=payload)
    assert r2.status_code == 201, r2.text
    body2 = r2.json()
    assert body2["source_id"] == body1["source_id"]
    # Still in imported[] — same-source path always reports imported.
    assert len(body2["imported"]) == 1
    assert body2["imported"][0]["name"] == names["python"]

    with _get_session() as db:
        s = db.query(Skill).filter(Skill.slug == names["python"]).one()
        assert s.source_content_hash == "H2"
        assert s.source_sha == "deadbeef"
        assert s.description == "updated description"


# ----- Forked skill ---------------------------------------------------------


def test_forked_skill_treated_as_conflict(monkeypatch, slug, names, cleanup):
    """A forked skill bypasses the same-source no-op branch and goes through conflict path."""
    track_col, track_src, track_skill = cleanup
    track_col(slug)
    track_skill(names["python"])

    stub = _make_stub_inspect(
        [
            {
                "name": names["python"],
                "description": "original imp desc",
                "path": "p",
                "content_hash": "H1",
            }
        ]
    )
    client = _client(monkeypatch, stub)
    payload = {
        "input": "owner/repo",
        "target_collection_slug": slug,
        "on_conflict": "rename",
    }

    r1 = client.post("/v1/import/apply", json=payload)
    assert r1.status_code == 201, r1.text
    body1 = r1.json()
    src_id = body1["source_id"]
    track_src(src_id)

    # Manually flip the skill to a forked state (user has since edited the
    # imported skill, severing the same-source contract).
    from app.db.models import Skill
    with _get_session() as db:
        s = db.query(Skill).filter(Skill.slug == names["python"]).one()
        s.forked_from_source = True
        s.description = "user-forked content"
        db.commit()
        pre_fork_id = s.id

    # Re-apply with stronger content_hash ("H2") to prove the same-source
    # branch WOULD have updated it if the fork flag weren't set.
    stub2 = _make_stub_inspect(
        [
            {
                "name": names["python"],
                "description": "imp should-not-apply",
                "path": "p",
                "content_hash": "H2",
            }
        ],
        sha="newsha1",
    )
    monkeypatch.setattr("app.api.imports.inspect_source", stub2)
    r2 = client.post("/v1/import/apply", json=payload)
    assert r2.status_code == 201, r2.text
    body2 = r2.json()
    assert body2["source_id"] == src_id  # same source row (UPSERT).

    # Conflict path with rename: expect base-2 created.
    renamed_slug = f"{names['python']}-2"
    track_skill(renamed_slug)
    assert len(body2["imported"]) == 1
    entry = body2["imported"][0]
    assert entry["name"] == renamed_slug
    assert entry["original_name"] == names["python"]
    assert entry["renamed_reason"] == "conflict"

    # Original forked skill is untouched.
    with _get_session() as db:
        forked = db.query(Skill).filter(Skill.slug == names["python"]).one()
        assert forked.id == pre_fork_id
        assert forked.forked_from_source is True
        assert forked.description == "user-forked content"
        assert forked.source_content_hash == "H1"

        # Renamed skill is newly created, attached to the same source.
        new_s = db.query(Skill).filter(Skill.slug == renamed_slug).one()
        assert new_s.import_source_id == uuid.UUID(src_id)
        assert new_s.forked_from_source is False
        assert new_s.description == "imp should-not-apply"


# ----- skill_selection gating ----------------------------------------------


def test_selection_excludes_unselected(monkeypatch, slug, names, cleanup):
    """skill_selection filters BEFORE conflict resolution. Excluded != skipped."""
    track_col, track_src, track_skill = cleanup
    track_col(slug)
    track_skill(names["python"])
    track_skill(names["js"])

    stub = _make_stub_inspect(
        [
            {"name": names["python"], "description": "p", "path": "p", "content_hash": "h"},
            {"name": names["rust"], "description": "r", "path": "r", "content_hash": "h"},
            {"name": names["js"], "description": "j", "path": "j", "content_hash": "h"},
        ]
    )
    client = _client(monkeypatch, stub)
    r = client.post(
        "/v1/import/apply",
        json={
            "input": "owner/repo",
            "target_collection_slug": slug,
            "skill_selection": [names["python"], names["js"]],
            "on_conflict": "rename",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    track_src(body["source_id"])

    imported_names = {s["name"] for s in body["imported"]}
    assert imported_names == {names["python"], names["js"]}
    assert len(body["imported"]) == 2

    # rust is NOT in imported AND NOT in skipped — it was filtered pre-conflict.
    assert body["skipped"] == []
    skipped_names = {s["name"] for s in body["skipped"]}
    assert names["rust"] not in skipped_names
    assert names["rust"] not in imported_names

    # DB: no skill row exists for rust.
    from app.db.models import Skill
    with _get_session() as db:
        rust_rows = db.query(Skill).filter(Skill.slug == names["rust"]).all()
        assert rust_rows == []
        # python + js were created.
        got = {
            row[0]
            for row in db.query(Skill.slug)
            .filter(Skill.slug.in_([names["python"], names["js"]]))
            .all()
        }
        assert got == {names["python"], names["js"]}
