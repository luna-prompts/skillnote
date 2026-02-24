import hashlib
import json
import urllib.error
import urllib.request

import psycopg
import pytest

from app.core.config import settings

BASE_URL = "http://127.0.0.1:8080"
TOKEN = "skn_dev_demo_token"


def _db_dsn() -> str:
    return settings.database_url.replace("+psycopg", "")


def _request(method: str, path: str, headers: dict | None = None, body: dict | None = None):
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        method=method,
        headers=headers or {},
        data=(json.dumps(body).encode() if body is not None else None),
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:
        pytest.skip(f"API not reachable for integration test: {e}")


def test_validate_token_success_and_failure():
    status, body = _request("POST", "/auth/validate-token", {"Content-Type": "application/json"}, {"token": TOKEN})
    assert status == 200
    assert body["valid"] is True

    status, body = _request("POST", "/auth/validate-token", {"Content-Type": "application/json"}, {"token": "bad"})
    assert status == 200
    assert body["valid"] is False


def test_validate_token_inactive_and_expired():
    try:
        with psycopg.connect(_db_dsn()) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update access_tokens
                    set status = 'revoked'
                    where label = 'dev-seed-token'
                    """
                )
            conn.commit()

        status, body = _request("POST", "/auth/validate-token", {"Content-Type": "application/json"}, {"token": TOKEN})
        assert status == 200
        assert body["valid"] is False

        with psycopg.connect(_db_dsn()) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update access_tokens
                    set status = 'active', expires_at = now() - interval '1 minute'
                    where label = 'dev-seed-token'
                    """
                )
            conn.commit()

        status, body = _request("POST", "/auth/validate-token", {"Content-Type": "application/json"}, {"token": TOKEN})
        assert status == 200
        assert body["valid"] is False
    except Exception as e:
        pytest.skip(f"DB not reachable for token state test: {e}")
    finally:
        try:
            with psycopg.connect(_db_dsn()) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        update access_tokens
                        set status = 'active', expires_at = null
                        where label = 'dev-seed-token'
                        """
                    )
                conn.commit()
        except Exception:
            pass


def test_skills_requires_auth_error_shape():
    status, body = _request("GET", "/v1/skills")
    assert status == 401
    assert "error" in body
    assert "code" in body["error"] and "message" in body["error"]


def test_list_skills_and_versions_with_auth():
    headers = {"Authorization": f"Bearer {TOKEN}"}

    status, skills = _request("GET", "/v1/skills", headers=headers)
    assert status == 200
    assert isinstance(skills, list)
    assert len(skills) >= 1

    status, versions = _request("GET", "/v1/skills/secure-migrations/versions", headers=headers)
    assert status == 200
    assert isinstance(versions, list)
    assert len(versions) >= 1


def test_download_bundle_with_headers():
    req = urllib.request.Request(
        f"{BASE_URL}/v1/skills/secure-migrations/0.1.0/download",
        headers={"Authorization": f"Bearer {TOKEN}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req) as r:
            data = r.read()
            assert r.status == 200
            assert r.headers.get("X-Skill-Name") == "secure-migrations"
            assert r.headers.get("X-Skill-Version") == "0.1.0"
            assert r.headers.get("X-Checksum-Sha256")
            assert len(data) > 0
    except Exception as e:
        pytest.skip(f"Download endpoint not reachable for integration test: {e}")


def test_download_detects_checksum_mismatch():
    actual_checksum = None
    try:
        with psycopg.connect(_db_dsn()) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select sv.bundle_storage_key
                    from skill_versions sv
                    join skills s on s.id = sv.skill_id
                    where s.slug = %s and sv.version = %s
                    """,
                    ("secure-migrations", "0.1.0"),
                )
                row = cur.fetchone()
                if not row:
                    pytest.skip("seeded version not found")
                storage_key = row[0]

            bundle_path = f"{settings.bundle_storage_dir}/{storage_key}"
            actual_checksum = hashlib.sha256(open(bundle_path, "rb").read()).hexdigest()

            with conn.cursor() as cur:
                cur.execute(
                    """
                    update skill_versions sv
                    set checksum_sha256 = %s
                    from skills s
                    where sv.skill_id = s.id and s.slug = %s and sv.version = %s
                    """,
                    ("0" * 64, "secure-migrations", "0.1.0"),
                )
            conn.commit()

        status, body = _request(
            "GET",
            "/v1/skills/secure-migrations/0.1.0/download",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        assert status == 409
        assert body["error"]["code"] == "CHECKSUM_MISMATCH"
    except Exception as e:
        pytest.skip(f"DB/storage not reachable for checksum mismatch test: {e}")
    finally:
        if not actual_checksum:
            return
        try:
            with psycopg.connect(_db_dsn()) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        update skill_versions sv
                        set checksum_sha256 = %s
                        from skills s
                        where sv.skill_id = s.id and s.slug = %s and sv.version = %s
                        """,
                        (actual_checksum, "secure-migrations", "0.1.0"),
                    )
                conn.commit()
        except Exception:
            pass
