"""Integration tests for slug auto-update when skill name changes.

Requires the backend API to be running at http://127.0.0.1:8080.
"""
import json
import urllib.error
import urllib.request

import pytest

BASE_URL = "http://127.0.0.1:8080"


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


def _cleanup(slug: str):
    """Best-effort delete to clean up test data."""
    try:
        _request("DELETE", f"/v1/skills/{slug}")
    except Exception:
        pass


# ── Slug auto-update on rename ────────────────────────────────────────

class TestSlugAutoUpdate:
    """Test that renaming a skill auto-updates its slug."""

    ORIGINAL_NAME = "slug-test-original"
    RENAMED_NAME = "slug-test-renamed"

    def setup_method(self):
        # Clean up any leftover test data
        _cleanup(self.ORIGINAL_NAME)
        _cleanup(self.RENAMED_NAME)

    def teardown_method(self):
        _cleanup(self.ORIGINAL_NAME)
        _cleanup(self.RENAMED_NAME)

    def _create_skill(self):
        status, body = _request(
            "POST", "/v1/skills",
            headers={"Content-Type": "application/json"},
            body={
                "name": self.ORIGINAL_NAME,
                "slug": self.ORIGINAL_NAME,
                "description": "Test skill for slug auto-update",
                "content_md": "# Original",
                "collections": [],
            },
        )
        assert status == 200, f"Create failed: {body}"
        return body

    def test_slug_updates_on_rename(self):
        """PATCH with new name → slug changes to match."""
        self._create_skill()

        # Rename
        status, body = _request(
            "PATCH", f"/v1/skills/{self.ORIGINAL_NAME}",
            headers={"Content-Type": "application/json"},
            body={"name": self.RENAMED_NAME},
        )
        assert status == 200
        assert body["name"] == self.RENAMED_NAME
        assert body["slug"] == self.RENAMED_NAME

    def test_old_slug_returns_404_after_rename(self):
        """After rename, the old slug should no longer resolve."""
        self._create_skill()

        # Rename
        _request(
            "PATCH", f"/v1/skills/{self.ORIGINAL_NAME}",
            headers={"Content-Type": "application/json"},
            body={"name": self.RENAMED_NAME},
        )

        # Old slug → 404
        status, _ = _request("GET", f"/v1/skills/{self.ORIGINAL_NAME}")
        assert status == 404

    def test_new_slug_resolves_after_rename(self):
        """After rename, the new slug should return the skill."""
        self._create_skill()

        _request(
            "PATCH", f"/v1/skills/{self.ORIGINAL_NAME}",
            headers={"Content-Type": "application/json"},
            body={"name": self.RENAMED_NAME},
        )

        status, body = _request("GET", f"/v1/skills/{self.RENAMED_NAME}")
        assert status == 200
        assert body["name"] == self.RENAMED_NAME

    def test_slug_unchanged_when_name_unchanged(self):
        """PATCH with same name → slug stays the same."""
        skill = self._create_skill()
        original_slug = skill["slug"]

        status, body = _request(
            "PATCH", f"/v1/skills/{original_slug}",
            headers={"Content-Type": "application/json"},
            body={"name": self.ORIGINAL_NAME},
        )
        assert status == 200
        assert body["slug"] == original_slug

    def test_slug_unchanged_when_only_description_updated(self):
        """PATCH without name → slug stays the same."""
        skill = self._create_skill()
        original_slug = skill["slug"]

        status, body = _request(
            "PATCH", f"/v1/skills/{original_slug}",
            headers={"Content-Type": "application/json"},
            body={"description": "Updated description only"},
        )
        assert status == 200
        assert body["slug"] == original_slug

    def test_rename_to_existing_slug_returns_409(self):
        """Renaming to a slug that another skill already has → 409."""
        self._create_skill()

        # Create a second skill
        _request(
            "POST", "/v1/skills",
            headers={"Content-Type": "application/json"},
            body={
                "name": self.RENAMED_NAME,
                "slug": self.RENAMED_NAME,
                "description": "Second skill",
                "content_md": "# Second",
                "collections": [],
            },
        )

        # Try to rename first skill to match second skill's name
        status, body = _request(
            "PATCH", f"/v1/skills/{self.ORIGINAL_NAME}",
            headers={"Content-Type": "application/json"},
            body={"name": self.RENAMED_NAME},
        )
        assert status == 409

    def test_content_versions_preserved_after_rename(self):
        """Renaming should not lose content version history."""
        self._create_skill()

        # Check versions exist under old slug
        status, versions_before = _request("GET", f"/v1/skills/{self.ORIGINAL_NAME}/content-versions")
        assert status == 200
        count_before = len(versions_before)

        # Rename
        _request(
            "PATCH", f"/v1/skills/{self.ORIGINAL_NAME}",
            headers={"Content-Type": "application/json"},
            body={"name": self.RENAMED_NAME},
        )

        # Versions should be accessible under new slug (rename also creates a new version)
        status, versions_after = _request("GET", f"/v1/skills/{self.RENAMED_NAME}/content-versions")
        assert status == 200
        assert len(versions_after) >= count_before


# ── Name validation on create/update ──────────────────────────────────

class TestNameValidation:
    """Test that the backend rejects invalid skill names."""

    def teardown_method(self):
        _cleanup("valid-test-skill")

    def test_create_rejects_uppercase_name(self):
        status, body = _request(
            "POST", "/v1/skills",
            headers={"Content-Type": "application/json"},
            body={
                "name": "InvalidUpperCase",
                "slug": "invaliduppercase",
                "description": "Test",
                "content_md": "",
                "collections": [],
            },
        )
        assert status == 422

    def test_create_rejects_spaces_in_name(self):
        status, body = _request(
            "POST", "/v1/skills",
            headers={"Content-Type": "application/json"},
            body={
                "name": "has spaces",
                "slug": "has-spaces",
                "description": "Test",
                "content_md": "",
                "collections": [],
            },
        )
        assert status == 422

    def test_create_rejects_reserved_word(self):
        status, body = _request(
            "POST", "/v1/skills",
            headers={"Content-Type": "application/json"},
            body={
                "name": "claude-helper",
                "slug": "claude-helper",
                "description": "Test",
                "content_md": "",
                "collections": [],
            },
        )
        assert status == 422

    def test_create_rejects_empty_name(self):
        status, body = _request(
            "POST", "/v1/skills",
            headers={"Content-Type": "application/json"},
            body={
                "name": "",
                "slug": "",
                "description": "Test",
                "content_md": "",
                "collections": [],
            },
        )
        assert status == 422

    def test_update_rejects_invalid_name(self):
        # Create a valid skill first
        _request(
            "POST", "/v1/skills",
            headers={"Content-Type": "application/json"},
            body={
                "name": "valid-test-skill",
                "slug": "valid-test-skill",
                "description": "Test",
                "content_md": "",
                "collections": [],
            },
        )

        # Try to rename to invalid name
        status, body = _request(
            "PATCH", "/v1/skills/valid-test-skill",
            headers={"Content-Type": "application/json"},
            body={"name": "Invalid Name!"},
        )
        assert status == 422

    def test_create_rejects_too_long_name(self):
        status, body = _request(
            "POST", "/v1/skills",
            headers={"Content-Type": "application/json"},
            body={
                "name": "a" * 65,
                "slug": "a" * 65,
                "description": "Test",
                "content_md": "",
                "collections": [],
            },
        )
        assert status == 422
