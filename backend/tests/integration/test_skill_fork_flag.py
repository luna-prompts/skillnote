"""Integration tests: editing an imported skill auto-flips forked_from_source.

Covers the fork-on-edit auto-flag wired into PATCH /v1/skills/{slug}.

This test works against whatever Postgres instance the running API is
configured to use. It tries, in order:

  1. SQLAlchemy against ``SKILLNOTE_DATABASE_URL`` (or the default
     ``localhost:5432`` dev DB).
  2. ``podman exec``-ing psql inside the compose ``postgres`` container.

Whichever backend can see a probe skill written through the API is used.
If neither works the tests skip (non-fatal on fresh boxes without podman).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass

import pytest


BASE_URL = os.environ.get("SKILLNOTE_TEST_BASE_URL", "http://127.0.0.1:8082")
DEFAULT_DB_URL = "postgresql+psycopg://skillnote:skillnote@localhost:5432/skillnote"
POSTGRES_CONTAINER = os.environ.get("SKILLNOTE_TEST_PG_CONTAINER", "skillnote_postgres_1")
CONTAINER_RUNNER = os.environ.get("SKILLNOTE_TEST_CONTAINER_RUNNER", "podman")


# ---------------------------------------------------------------------------
# DB access shim: either SQLAlchemy or podman-exec psql. Both expose the same
# minimal surface (execute + fetchone) so tests can call through one object.
# ---------------------------------------------------------------------------


@dataclass
class PsqlBackend:
    """Run SQL via ``podman exec psql`` (or docker exec)."""

    container: str
    runner: str

    def _run(self, sql: str) -> str:
        proc = subprocess.run(
            [
                self.runner, "exec", "-i", self.container,
                "psql", "-U", "skillnote", "-d", "skillnote",
                "-At", "-v", "ON_ERROR_STOP=1", "-c", sql,
            ],
            capture_output=True, text=True, timeout=15,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"psql failed: {proc.stderr or proc.stdout}")
        return proc.stdout

    def execute(self, sql: str) -> None:
        self._run(sql)

    def fetchone(self, sql: str) -> tuple[str, ...] | None:
        out = self._run(sql).strip()
        if not out:
            return None
        return tuple(out.split("|"))


@dataclass
class SQLABackend:
    """Run SQL via SQLAlchemy. Used when a reachable DB URL is found."""

    url: str

    def __post_init__(self):
        from sqlalchemy import create_engine
        self._engine = create_engine(self.url, future=True)

    def execute(self, sql: str) -> None:
        from sqlalchemy import text
        with self._engine.begin() as c:
            c.execute(text(sql))

    def fetchone(self, sql: str) -> tuple[str, ...] | None:
        from sqlalchemy import text
        with self._engine.connect() as c:
            row = c.execute(text(sql)).first()
            if row is None:
                return None
            return tuple("" if v is None else str(v) for v in row)


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------


def _api_available() -> bool:
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=2) as r:
            return 200 <= r.status < 500
    except Exception:
        return False


def _post_skill_via_api(slug: str, collection: str = "general") -> dict | None:
    payload = {
        "name": slug,
        "slug": slug,
        "description": "probe for fork-flag test",
        "content_md": "# probe\n",
        "collections": [collection],
    }
    req = urllib.request.Request(
        f"{BASE_URL}/v1/skills",
        method="POST",
        headers={"Content-Type": "application/json"},
        data=json.dumps(payload).encode(),
    )
    try:
        with urllib.request.urlopen(req) as r:
            if 200 <= r.status < 300:
                return json.loads(r.read().decode())
            return None
    except Exception:
        return None


def _delete_skill_via_api(slug: str) -> None:
    req = urllib.request.Request(f"{BASE_URL}/v1/skills/{slug}", method="DELETE")
    try:
        with urllib.request.urlopen(req):
            pass
    except Exception:
        pass


def _patch_skill(slug: str, body: dict) -> int:
    req = urllib.request.Request(
        f"{BASE_URL}/v1/skills/{slug}",
        method="PATCH",
        headers={"Content-Type": "application/json"},
        data=json.dumps(body).encode(),
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _resolve_db_backend(probe_slug: str):
    """Find a DB backend that sees skills written by the running API."""
    if _post_skill_via_api(probe_slug) is None:
        return None

    # Try SQLAlchemy URLs first.
    candidate_urls: list[str] = []
    env_url = os.environ.get("SKILLNOTE_DATABASE_URL")
    if env_url:
        candidate_urls.append(env_url)
    candidate_urls.extend([
        DEFAULT_DB_URL,
        "postgresql+psycopg://skillnote:skillnote@127.0.0.1:5432/skillnote",
    ])
    for url in candidate_urls:
        try:
            backend = SQLABackend(url=url)
            row = backend.fetchone(f"SELECT 1 FROM skills WHERE slug = '{probe_slug}'")
            if row is not None:
                _delete_skill_via_api(probe_slug)
                return backend
        except Exception:
            continue

    # Fall back to container exec.
    if shutil.which(CONTAINER_RUNNER):
        backend = PsqlBackend(container=POSTGRES_CONTAINER, runner=CONTAINER_RUNNER)
        try:
            row = backend.fetchone(f"SELECT 1 FROM skills WHERE slug = '{probe_slug}'")
            if row is not None:
                _delete_skill_via_api(probe_slug)
                return backend
        except Exception:
            pass

    _delete_skill_via_api(probe_slug)
    return None


@pytest.fixture(scope="module")
def db_backend():
    if not _api_available():
        pytest.skip("API not reachable at " + BASE_URL)
    probe = f"forkprobe-{uuid.uuid4().hex[:8]}"
    backend = _resolve_db_backend(probe)
    if backend is None:
        pytest.skip(
            "Could not find DB backend matching the running API "
            "(tried SQLAlchemy URLs and podman exec)"
        )
    return backend


# ---------------------------------------------------------------------------
# Seed / cleanup helpers (backend-agnostic)
# ---------------------------------------------------------------------------


def _seed_imported_skill(backend, prefix: str) -> tuple[str, str, str, str]:
    """Create a Collection + ImportSource + imported Skill. Return ids/slugs."""
    collection_name = f"{prefix}-{uuid.uuid4().hex[:8]}"
    src_id = str(uuid.uuid4())
    skill_id = str(uuid.uuid4())
    skill_slug = f"imp-{uuid.uuid4().hex[:8]}"
    src_url = f"github.com/x/y-{uuid.uuid4().hex[:6]}"

    backend.execute(
        f"INSERT INTO collections (name, description) "
        f"VALUES ('{collection_name}', 'test')"
    )
    backend.execute(
        f"INSERT INTO import_sources "
        f"(id, source_type, url, owner, repo, ref, kind, collection_name, "
        f"imported_at_sha, status) "
        f"VALUES ('{src_id}', 'github', '{src_url}', 'x', 'y', 'main', "
        f"'plugin', '{collection_name}', 'aaaaaaa', 'up_to_date')"
    )
    backend.execute(
        f"INSERT INTO skills "
        f"(id, name, slug, description, content_md, collections, "
        f"current_version, import_source_id, source_content_hash, "
        f"forked_from_source) "
        f"VALUES ('{skill_id}', '{skill_slug}', '{skill_slug}', "
        f"'imported', '# Original Body\n', ARRAY['{collection_name}']::text[], "
        f"0, '{src_id}', 'hash-orig', FALSE)"
    )
    return collection_name, src_id, skill_id, skill_slug


def _get_skill_fork_flag(backend, skill_id: str) -> bool | None:
    row = backend.fetchone(
        f"SELECT forked_from_source FROM skills WHERE id = '{skill_id}'"
    )
    if row is None:
        return None
    val = row[0].strip().lower()
    return val in ("t", "true")


def _get_skill_content(backend, skill_id: str) -> str | None:
    row = backend.fetchone(
        f"SELECT content_md FROM skills WHERE id = '{skill_id}'"
    )
    return row[0] if row else None


def _set_skill_fork_flag(backend, skill_id: str, value: bool) -> None:
    backend.execute(
        f"UPDATE skills SET forked_from_source = {'TRUE' if value else 'FALSE'} "
        f"WHERE id = '{skill_id}'"
    )


def _cleanup(backend, collection_name: str, src_id: str, skill_id: str) -> None:
    try:
        backend.execute(f"DELETE FROM skills WHERE id = '{skill_id}'")
    except Exception:
        pass
    try:
        backend.execute(f"DELETE FROM import_sources WHERE id = '{src_id}'")
    except Exception:
        pass
    try:
        backend.execute(f"DELETE FROM collections WHERE name = '{collection_name}'")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_fork_on_edit_flips_flag_content_md(db_backend):
    """Editing content_md on an imported skill flips forked_from_source to True."""
    collection_name, src_id, skill_id, skill_slug = _seed_imported_skill(
        db_backend, "fork-test"
    )
    try:
        assert _get_skill_fork_flag(db_backend, skill_id) is False

        status = _patch_skill(skill_slug, {"content_md": "# Edited Body\n"})
        assert 200 <= status < 300, f"PATCH failed with {status}"

        assert _get_skill_fork_flag(db_backend, skill_id) is True, (
            "forked_from_source should be True after content edit"
        )
        content = _get_skill_content(db_backend, skill_id)
        assert content is not None and "Edited Body" in content
    finally:
        _cleanup(db_backend, collection_name, src_id, skill_id)


def test_fork_on_edit_flips_flag_description_only(db_backend):
    """Editing only the description still flips the fork flag."""
    collection_name, src_id, skill_id, skill_slug = _seed_imported_skill(
        db_backend, "fork-desc"
    )
    try:
        assert _get_skill_fork_flag(db_backend, skill_id) is False

        status = _patch_skill(
            skill_slug, {"description": "locally edited description"}
        )
        assert 200 <= status < 300, f"PATCH failed with {status}"

        assert _get_skill_fork_flag(db_backend, skill_id) is True
    finally:
        _cleanup(db_backend, collection_name, src_id, skill_id)


def test_non_imported_skill_is_not_affected(db_backend):
    """Editing a skill that was never imported does not set forked_from_source."""
    skill_slug = f"local-{uuid.uuid4().hex[:8]}"
    created = _post_skill_via_api(skill_slug)
    if created is None:
        pytest.fail("Could not create local skill via API")
    skill_id = created["id"]

    try:
        status = _patch_skill(skill_slug, {"content_md": "# Local edited\n"})
        assert 200 <= status < 300, f"PATCH failed with {status}"

        assert _get_skill_fork_flag(db_backend, skill_id) is False, (
            "non-imported skill must not gain fork flag"
        )
    finally:
        _delete_skill_via_api(skill_slug)


def test_fork_flag_stays_true_once_set(db_backend):
    """Subsequent edits on an already-forked skill keep the flag True."""
    collection_name, src_id, skill_id, skill_slug = _seed_imported_skill(
        db_backend, "fork-sticky"
    )
    _set_skill_fork_flag(db_backend, skill_id, True)

    try:
        status = _patch_skill(skill_slug, {"content_md": "# Re-edited\n"})
        assert 200 <= status < 300, f"PATCH failed with {status}"

        assert _get_skill_fork_flag(db_backend, skill_id) is True
    finally:
        _cleanup(db_backend, collection_name, src_id, skill_id)
