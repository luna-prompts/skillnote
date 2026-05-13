"""Integration tests for /v1/skills/{slug}/{version}/download.

Covers the error paths — 404 (no skill, no version, missing file), 403
(disabled version), 409 (checksum mismatch). The happy-path test requires
seeding an actual bundle file matching a published version; deferred to a
later round.

Requires a running backend on 127.0.0.1:8082 AND the same Postgres the API
is using (default: localhost:5432, override via SKILLNOTE_DATABASE_URL).
Tests skip if either is unreachable.
"""
import hashlib
import json
import os
import urllib.error
import urllib.request
import uuid
from typing import Optional

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
DB_URL = os.environ.get(
    "SKILLNOTE_DATABASE_URL",
    "postgresql+psycopg://skillnote:skillnote@localhost:5432/skillnote",
)
# `app.services.storage_service.storage.resolve()` rebases against the
# BUNDLE_STORAGE_DIR setting. Inside Docker that's /app/data/bundles.
BUNDLE_DIR = os.environ.get("SKILLNOTE_BUNDLE_STORAGE_DIR", "/app/data/bundles")


def _get(path: str):
    req = urllib.request.Request(f"{BASE_URL}{path}", method="GET")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, body
    except Exception as e:
        pytest.skip(f"API not reachable: {e}")


@pytest.fixture(scope="module")
def engine():
    e = create_engine(DB_URL)
    try:
        with e.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as exc:
        pytest.skip(f"DB not reachable: {exc}")
    return e


@pytest.fixture
def db(engine):
    Session = sessionmaker(bind=engine)
    with Session() as s:
        yield s


def _make_skill(db, name: str) -> str:
    """Insert a Skill row directly and return its id (uuid string)."""
    skill_id = str(uuid.uuid4())
    db.execute(
        text(
            "INSERT INTO skills (id, slug, name, description, content_md, "
            "current_version, created_at, updated_at) "
            "VALUES (:id, :slug, :name, 'fixture', '# x', 1, NOW(), NOW())"
        ),
        {"id": skill_id, "slug": name, "name": name},
    )
    db.commit()
    return skill_id


def _make_version(
    db,
    skill_id: str,
    version: str,
    *,
    status: str = "active",
    bundle_storage_key: str = "fixtures/missing.zip",
    checksum: str = "0" * 64,
) -> None:
    db.execute(
        text(
            "INSERT INTO skill_versions (id, skill_id, version, checksum_sha256, "
            "bundle_storage_key, status, channel, published_at) "
            "VALUES (:id, :skill_id, :version, :checksum, :key, :status, 'stable', NOW())"
        ),
        {
            "id": str(uuid.uuid4()),
            "skill_id": skill_id,
            "version": version,
            "checksum": checksum,
            "key": bundle_storage_key,
            "status": status,
        },
    )
    db.commit()


def _cleanup_skill(db, slug: str) -> None:
    db.execute(text("DELETE FROM skills WHERE slug = :s"), {"s": slug})
    db.commit()


# ── 404 / 403 / 409 paths ────────────────────────────────────────────────────


def test_download_unknown_skill_returns_404():
    status, body = _get(f"/v1/skills/doesnotexist-{uuid.uuid4().hex[:8]}/1.0.0/download")
    assert status == 404
    assert isinstance(body, dict)
    assert body["error"]["code"] == "SKILL_NOT_FOUND"


def test_download_unknown_version_returns_404(db):
    slug = f"dl-test-{uuid.uuid4().hex[:8]}"
    _make_skill(db, slug)
    try:
        status, body = _get(f"/v1/skills/{slug}/9.9.9/download")
        assert status == 404
        assert body["error"]["code"] == "VERSION_NOT_FOUND"
    finally:
        _cleanup_skill(db, slug)


def test_download_disabled_version_returns_403(db):
    slug = f"dl-test-{uuid.uuid4().hex[:8]}"
    sid = _make_skill(db, slug)
    _make_version(db, sid, "1.0.0", status="disabled")
    try:
        status, body = _get(f"/v1/skills/{slug}/1.0.0/download")
        assert status == 403
        assert body["error"]["code"] == "VERSION_DISABLED"
    finally:
        _cleanup_skill(db, slug)


def test_download_missing_bundle_file_returns_404(db):
    """Storage key points to a path that doesn't exist on disk → 404."""
    slug = f"dl-test-{uuid.uuid4().hex[:8]}"
    sid = _make_skill(db, slug)
    _make_version(
        db,
        sid,
        "1.0.0",
        status="active",
        bundle_storage_key=f"missing/{uuid.uuid4().hex}.zip",
    )
    try:
        status, body = _get(f"/v1/skills/{slug}/1.0.0/download")
        assert status == 404
        assert body["error"]["code"] == "BUNDLE_NOT_FOUND"
    finally:
        _cleanup_skill(db, slug)


def test_download_checksum_mismatch_returns_409(db, tmp_path_factory):
    """Seed a real bundle file but with a wrong checksum recorded in DB → 409.

    Only runs when the bundle dir is writable from this test process (i.e.
    we're inside the api container or share its mount). Skip otherwise.
    """
    if not os.path.isdir(BUNDLE_DIR) or not os.access(BUNDLE_DIR, os.W_OK):
        pytest.skip(f"BUNDLE_DIR {BUNDLE_DIR} not writable from test process")

    slug = f"dl-test-{uuid.uuid4().hex[:8]}"
    sid = _make_skill(db, slug)

    # Write a real file, but record a wrong checksum so resolution fires the
    # CHECKSUM_MISMATCH branch.
    bundle_filename = f"{uuid.uuid4().hex}.zip"
    bundle_path = os.path.join(BUNDLE_DIR, bundle_filename)
    with open(bundle_path, "wb") as f:
        f.write(b"not a real zip but enough bytes to hash")

    _make_version(
        db,
        sid,
        "1.0.0",
        status="active",
        bundle_storage_key=bundle_filename,
        checksum="deadbeef" * 8,  # 64 hex chars but obviously wrong
    )
    try:
        status, body = _get(f"/v1/skills/{slug}/1.0.0/download")
        assert status == 409
        assert body["error"]["code"] == "CHECKSUM_MISMATCH"
    finally:
        try:
            os.remove(bundle_path)
        except OSError:
            pass
        _cleanup_skill(db, slug)


def test_download_happy_path_returns_zip(db):
    """End-to-end: real file on disk + correct checksum → 200 + ZIP bytes."""
    if not os.path.isdir(BUNDLE_DIR) or not os.access(BUNDLE_DIR, os.W_OK):
        pytest.skip(f"BUNDLE_DIR {BUNDLE_DIR} not writable from test process")

    slug = f"dl-test-{uuid.uuid4().hex[:8]}"
    sid = _make_skill(db, slug)

    bundle_filename = f"{uuid.uuid4().hex}.zip"
    bundle_path = os.path.join(BUNDLE_DIR, bundle_filename)
    payload = b"PK\x03\x04mock-zip-bytes-for-test-fixture"
    with open(bundle_path, "wb") as f:
        f.write(payload)
    real_checksum = hashlib.sha256(payload).hexdigest()

    _make_version(
        db,
        sid,
        "1.0.0",
        status="active",
        bundle_storage_key=bundle_filename,
        checksum=real_checksum,
    )
    try:
        status, body = _get(f"/v1/skills/{slug}/1.0.0/download")
        assert status == 200
        # body is raw bytes for non-error responses
        assert isinstance(body, (bytes, bytearray))
        assert bytes(body) == payload
    finally:
        try:
            os.remove(bundle_path)
        except OSError:
            pass
        _cleanup_skill(db, slug)
