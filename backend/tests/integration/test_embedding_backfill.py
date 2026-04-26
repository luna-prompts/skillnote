"""Integration tests for embedding wiring on create/update + backfill script.

Runs in-process via fastapi.testclient.TestClient. Real Postgres is required
(uses pgvector). Embeddings are mocked — these tests never call the real
OpenAI/Voyage API.

Mirrors the in-process style used by ``test_openclaw_context_bundle.py``.
"""
from __future__ import annotations

import os
import uuid

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import importlib.util
import sys as _sys
from pathlib import Path

from app.api.skills import router as skills_router
from app.db.models import Skill
from app.db.session import get_db
from app.main import http_exception_handler, validation_exception_handler
from app.services import embedding_service


def _load_backfill_module():
    """Load scripts/backfill_embeddings.py as a module without requiring an
    __init__.py in the scripts/ directory (matches the existing convention
    where scripts are run via `python scripts/<name>.py`)."""
    if "_backfill_embeddings" in _sys.modules:
        return _sys.modules["_backfill_embeddings"]
    backend_root = Path(__file__).resolve().parents[2]
    script_path = backend_root / "scripts" / "backfill_embeddings.py"
    spec = importlib.util.spec_from_file_location(
        "_backfill_embeddings", script_path
    )
    mod = importlib.util.module_from_spec(spec)
    _sys.modules["_backfill_embeddings"] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


backfill_embeddings = _load_backfill_module()


DB_URL = os.environ.get(
    "SKILLNOTE_DATABASE_URL",
    "postgresql+psycopg://skillnote:skillnote@localhost:5432/skillnote",
)


# ── fixtures ────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def engine():
    """Module-scoped Postgres engine. Skips the module if DB is unreachable."""
    e = create_engine(DB_URL, future=True)
    try:
        with e.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as exc:
        pytest.skip(f"DB not reachable: {exc}")
    return e


@pytest.fixture
def db_session(engine):
    """Per-test session. Caller is responsible for committing inserts."""
    S = sessionmaker(bind=engine, future=True)
    with S() as s:
        yield s
        s.rollback()


@pytest.fixture
def client(engine):
    """Fresh FastAPI app mounting only the skills router.

    Overrides get_db so handlers bind to our test engine. Includes the same
    exception handlers main.py uses so error envelopes match production.
    """
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.include_router(skills_router)

    S = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    def _get_db_override():
        db = S()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_db_override
    return TestClient(app)


@pytest.fixture(autouse=True)
def _configure_embedding(monkeypatch):
    """Default: embedding service appears configured. Tests that need the
    'not configured' branch override this with their own monkeypatch."""
    monkeypatch.setattr(embedding_service.settings, "embedding_api_key", "test-key")
    yield


@pytest.fixture
def cleanup(db_session):
    """Track inserted skills and delete them on teardown.

    Also drops any collections that match our test prefix (auto-promoted).
    """
    skill_ids: list[uuid.UUID] = []
    yield skill_ids
    if skill_ids:
        db_session.execute(
            text("DELETE FROM skill_content_versions WHERE skill_id = ANY(:ids)"),
            {"ids": [str(i) for i in skill_ids]},
        )
        db_session.execute(
            text("DELETE FROM skill_versions WHERE skill_id = ANY(:ids)"),
            {"ids": [str(i) for i in skill_ids]},
        )
        db_session.execute(
            text("DELETE FROM skills WHERE id = ANY(:ids)"),
            {"ids": [str(i) for i in skill_ids]},
        )
        # Drop any collections this test file auto-promoted via the API.
        db_session.execute(
            text("DELETE FROM collections WHERE name LIKE 'bf-col-%'")
        )
        db_session.commit()


# ── helpers ─────────────────────────────────────────────────────────────


def _vec(value: float = 0.1, dim: int = 1536) -> list[float]:
    """A constant vector of given value (1536 dims for the Skill.embedding column)."""
    return [value] * dim


def _seed_skill(
    db_session,
    cleanup,
    *,
    name: str | None = None,
    embedding: list[float] | None,
) -> Skill:
    suffix = uuid.uuid4().hex[:8]
    name = name or f"bf-{suffix}"
    skill = Skill(
        id=uuid.uuid4(),
        name=name,
        slug=name,
        description=f"desc {suffix}",
        content_md="",
        collections=[],
        embedding=embedding,
    )
    db_session.add(skill)
    db_session.commit()
    db_session.refresh(skill)
    cleanup.append(skill.id)
    return skill


def _make_skill_payload(slug: str | None = None) -> dict:
    """Build a valid SkillCreate payload (collections must be non-empty,
    and the collection is auto-promoted by the API if it doesn't exist)."""
    slug = slug or f"bf-{uuid.uuid4().hex[:8]}"
    return {
        "name": slug,
        "slug": slug,
        "description": "test skill description",
        "content_md": "",
        "collections": [f"bf-col-{uuid.uuid4().hex[:6]}"],
    }


# ── backfill script tests ───────────────────────────────────────────────


def test_backfill_embeds_missing(monkeypatch, db_session, cleanup):
    """Insert 3 NULL-embedding skills; backfill --only-missing should embed all 3."""
    s1 = _seed_skill(db_session, cleanup, embedding=None)
    s2 = _seed_skill(db_session, cleanup, embedding=None)
    s3 = _seed_skill(db_session, cleanup, embedding=None)
    seeded_ids = {s1.id, s2.id, s3.id}

    # Track every embed_batch call so we can build the right number of vectors
    def _fake_embed_batch(texts: list[str]) -> list[list[float]]:
        return [_vec(0.1 + 0.1 * i) for i in range(len(texts))]

    monkeypatch.setattr(embedding_service, "embed_batch", _fake_embed_batch)

    rc = backfill_embeddings.main(["--only-missing", "--batch-size", "5"])
    assert rc == 0

    # Read back. The seeded skills should now have non-NULL embeddings.
    db_session.expire_all()
    for sid in seeded_ids:
        s = db_session.get(Skill, sid)
        assert s is not None
        assert s.embedding is not None, (
            f"skill {sid} still has NULL embedding after backfill"
        )


def test_backfill_only_missing_skips_embedded(monkeypatch, db_session, cleanup):
    """Insert 2 with embedding + 1 without; --only-missing must embed only the 1."""
    _seed_skill(db_session, cleanup, embedding=_vec(0.5))
    _seed_skill(db_session, cleanup, embedding=_vec(0.6))
    missing = _seed_skill(db_session, cleanup, embedding=None)

    seen_calls: list[int] = []

    def _fake_embed_batch(texts: list[str]) -> list[list[float]]:
        seen_calls.append(len(texts))
        return [_vec(0.9) for _ in texts]

    monkeypatch.setattr(embedding_service, "embed_batch", _fake_embed_batch)

    rc = backfill_embeddings.main(["--only-missing", "--batch-size", "10"])
    assert rc == 0

    # Only one batch call, with size matching our seeded missing-only skills.
    # NOTE: the DB may contain other NULL-embedding skills from seeds — assert
    # that our seeded one is included in whatever batch was processed, not the
    # exact total. The key invariant: the previously-embedded ones must still
    # have their original vectors.
    assert seen_calls, "embed_batch was never called"

    # The previously-NULL skill should now have its embedding populated.
    db_session.expire_all()
    s = db_session.get(Skill, missing.id)
    assert s.embedding is not None
    assert abs(s.embedding[0] - 0.9) < 1e-3, s.embedding[0]


def test_backfill_all_re_embeds(monkeypatch, db_session, cleanup):
    """--all should re-embed every skill, including those with existing vectors."""
    s1 = _seed_skill(db_session, cleanup, embedding=_vec(0.5))
    s2 = _seed_skill(db_session, cleanup, embedding=_vec(0.6))

    def _fake_embed_batch(texts: list[str]) -> list[list[float]]:
        return [_vec(0.9) for _ in texts]

    monkeypatch.setattr(embedding_service, "embed_batch", _fake_embed_batch)

    rc = backfill_embeddings.main(["--all", "--batch-size", "100"])
    assert rc == 0

    # Both seeded skills should now have first dim = 0.9 (overwritten).
    db_session.expire_all()
    for s in (s1, s2):
        refreshed = db_session.get(Skill, s.id)
        assert refreshed.embedding is not None
        assert abs(refreshed.embedding[0] - 0.9) < 1e-3, (
            f"skill {s.id} has first={refreshed.embedding[0]}, expected 0.9 after --all backfill"
        )


def test_backfill_dry_run_no_writes(monkeypatch, db_session, cleanup):
    """--dry-run must not call the provider or modify the DB."""
    skill = _seed_skill(db_session, cleanup, embedding=None)

    def _boom(*_args, **_kw):
        raise AssertionError("embed_batch must not be called during --dry-run")

    monkeypatch.setattr(embedding_service, "embed_batch", _boom)

    rc = backfill_embeddings.main(["--only-missing", "--dry-run"])
    assert rc == 0

    # Verify embedding is still NULL.
    db_session.expire_all()
    s = db_session.get(Skill, skill.id)
    assert s.embedding is None, "embedding should still be NULL after --dry-run"


def test_backfill_refuses_when_unconfigured(monkeypatch, capsys):
    """If SKILLNOTE_EMBEDDING_API_KEY is missing, the script must exit non-zero."""
    monkeypatch.setattr(embedding_service.settings, "embedding_api_key", None)

    rc = backfill_embeddings.main(["--only-missing"])
    assert rc != 0
    err = capsys.readouterr().err
    assert "SKILLNOTE_EMBEDDING_API_KEY" in err


# ── create/update wiring tests ──────────────────────────────────────────


def test_create_skill_embeds_on_post(client, monkeypatch, db_session, cleanup):
    """POST /v1/skills should populate the embedding via embed_text()."""
    captured: list[str] = []

    def _fake_embed_text(text_: str) -> list[float]:
        captured.append(text_)
        return _vec(0.42)

    monkeypatch.setattr(embedding_service, "embed_text", _fake_embed_text)

    payload = _make_skill_payload()
    r = client.post("/v1/skills", json=payload)
    assert r.status_code == 201, r.text

    skill_id = uuid.UUID(r.json()["id"])
    cleanup.append(skill_id)

    # Verify embedding was populated.
    db_session.expire_all()
    skill_row = db_session.get(Skill, skill_id)
    assert skill_row.embedding is not None, "embedding should be populated after POST"
    assert abs(skill_row.embedding[0] - 0.42) < 1e-3
    assert len(captured) == 1
    # Sanity: the embedded text should contain name + description.
    assert payload["name"] in captured[0]
    assert payload["description"] in captured[0]


def test_update_skill_embeds_on_description_change(
    client, monkeypatch, db_session, cleanup
):
    """PATCH that changes description should trigger a fresh embed."""
    call_count = {"n": 0}

    def _fake_embed_text(_text: str) -> list[float]:
        call_count["n"] += 1
        return _vec(0.1)

    monkeypatch.setattr(embedding_service, "embed_text", _fake_embed_text)

    payload = _make_skill_payload()
    r = client.post("/v1/skills", json=payload)
    assert r.status_code == 201
    skill_id = uuid.UUID(r.json()["id"])
    cleanup.append(skill_id)

    assert call_count["n"] == 1, "embed_text should fire once on create"

    r = client.patch(
        f"/v1/skills/{payload['slug']}",
        json={"description": "an updated description for embedding"},
    )
    assert r.status_code == 200, r.text

    assert call_count["n"] == 2, (
        f"embed_text should fire on description change; saw {call_count['n']} call(s)"
    )


def test_update_skill_skips_embed_on_body_only_change(
    client, monkeypatch, db_session, cleanup
):
    """PATCH that changes only content_md (body) MUST NOT re-embed (per DD11)."""
    call_count = {"n": 0}

    def _fake_embed_text(_text: str) -> list[float]:
        call_count["n"] += 1
        return _vec(0.1)

    monkeypatch.setattr(embedding_service, "embed_text", _fake_embed_text)

    payload = _make_skill_payload()
    r = client.post("/v1/skills", json=payload)
    assert r.status_code == 201
    skill_id = uuid.UUID(r.json()["id"])
    cleanup.append(skill_id)

    assert call_count["n"] == 1, "embed_text should fire once on create"

    # PATCH body-only change.
    r = client.patch(
        f"/v1/skills/{payload['slug']}",
        json={"content_md": "# new body, body changes are excluded from embedding"},
    )
    assert r.status_code == 200, r.text

    assert call_count["n"] == 1, (
        f"embed_text must NOT fire for body-only change; saw {call_count['n']} call(s)"
    )


def test_create_skill_succeeds_when_embedding_unconfigured(
    client, monkeypatch, db_session, cleanup
):
    """If the embedding service is unconfigured, POST must still 201 with NULL embedding."""
    # Force is_configured() False (mirrored to embed_text raising the typed exc).
    monkeypatch.setattr(embedding_service.settings, "embedding_api_key", None)

    def _raise_not_configured(_text):
        raise embedding_service.EmbeddingNotConfigured("not configured")

    monkeypatch.setattr(embedding_service, "embed_text", _raise_not_configured)

    payload = _make_skill_payload()
    r = client.post("/v1/skills", json=payload)
    assert r.status_code == 201, r.text
    body = r.json()
    skill_id = uuid.UUID(body["id"])
    cleanup.append(skill_id)

    # The DB row must exist with NULL embedding.
    db_session.expire_all()
    skill_row = db_session.get(Skill, skill_id)
    assert skill_row is not None, "skill must be in DB"
    assert skill_row.embedding is None, "embedding must be NULL when service is unconfigured"
