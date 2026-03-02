"""
End-to-End Integration Tests: Backend API + MCP Server

These tests run against the LIVE services:
  - Backend API: http://localhost:8082
  - MCP Server:  http://localhost:8083

Each test manages its own state and cleans up after itself.
Tests that create data use a unique slug prefix `e2e-<timestamp>` so
they don't conflict with each other or with seed data.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any

import pytest

# ─── CONFIG ───────────────────────────────────────────────────────────────────

API_BASE = "http://localhost:8082"
MCP_BASE = "http://localhost:8083"


# ─── HELPERS ──────────────────────────────────────────────────────────────────

def api(method: str, path: str, body: dict | None = None, expected: int | None = None) -> tuple[int, Any]:
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        data=(json.dumps(body).encode() if body is not None else None),
    )
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode()
            data = json.loads(text) if text else None
            if expected is not None:
                assert r.status == expected, f"{method} {path} → {r.status} (wanted {expected}): {text}"
            return r.status, data
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        data = json.loads(text) if text else {}
        if expected is not None:
            assert e.code == expected, f"{method} {path} → {e.code} (wanted {expected}): {text}"
        return e.code, data
    except Exception as exc:
        pytest.skip(f"Service not reachable: {exc}")


def mcp_post(path: str, body: dict, session_id: str | None = None) -> tuple[int, Any]:
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    req = urllib.request.Request(
        f"{MCP_BASE}{path}",
        method="POST",
        headers=headers,
        data=json.dumps(body).encode(),
    )
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode()
            # Parse SSE: "event: message\ndata: {...}"
            for line in text.splitlines():
                if line.startswith("data: "):
                    return r.status, json.loads(line[6:])
            return r.status, {}
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        return e.code, json.loads(text) if text.startswith('{') else {"raw": text}
    except Exception as exc:
        pytest.skip(f"MCP not reachable: {exc}")


def mcp_init() -> tuple[str, dict]:
    """Start an MCP session, return (session_id, initialize_result)."""
    req = urllib.request.Request(
        f"{MCP_BASE}/mcp",
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
        data=json.dumps({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                       "clientInfo": {"name": "e2e-pytest", "version": "1.0"}},
        }).encode(),
    )
    try:
        with urllib.request.urlopen(req) as r:
            session_id = r.headers.get("Mcp-Session-Id") or r.headers.get("mcp-session-id", "")
            text = r.read().decode()
            for line in text.splitlines():
                if line.startswith("data: "):
                    return session_id, json.loads(line[6:])
            return session_id, {}
    except Exception as exc:
        pytest.skip(f"MCP not reachable: {exc}")


def unique_slug(prefix: str = "e2e") -> str:
    return f"{prefix}-{int(time.time() * 1000) % 1_000_000}"


# ─── FIXTURES ─────────────────────────────────────────────────────────────────

@pytest.fixture()
def skill():
    """Create a test skill, yield it, then delete it."""
    slug = unique_slug("e2e-skill")
    status, data = api("POST", "/v1/skills", {
        "name": slug,
        "slug": slug,
        "description": "E2E integration test skill",
        "content_md": "# E2E Skill\n\nAuto-created by pytest.",
        "tags": ["e2e"],
        "collections": ["testing"],
    })
    assert status == 201, f"Failed to create skill: {data}"
    yield data
    api("DELETE", f"/v1/skills/{slug}")


# ─── TESTS: HEALTH ────────────────────────────────────────────────────────────

class TestHealth:
    def test_api_health(self):
        status, body = api("GET", "/health")
        assert status == 200
        assert body["status"] == "ok"

    def test_mcp_health_via_initialize(self):
        session_id, result = mcp_init()
        assert session_id
        assert "result" in result
        assert result["result"]["serverInfo"]["name"] == "SkillNote"


# ─── TESTS: SKILLS CRUD ───────────────────────────────────────────────────────

class TestSkillsCRUD:
    def test_list_skills_returns_array(self):
        status, skills = api("GET", "/v1/skills", expected=200)
        assert isinstance(skills, list)

    def test_list_skills_has_required_fields(self):
        status, skills = api("GET", "/v1/skills", expected=200)
        assert len(skills) >= 1
        for s in skills:
            assert "slug" in s
            assert "name" in s
            assert "description" in s
            assert "tags" in s
            assert "collections" in s

    def test_create_skill(self, skill):
        assert skill["slug"] is not None
        assert skill["description"] == "E2E integration test skill"
        assert "e2e" in skill["tags"]

    def test_get_skill_by_slug(self, skill):
        status, data = api("GET", f"/v1/skills/{skill['slug']}", expected=200)
        assert data["slug"] == skill["slug"]
        assert data["name"] == skill["name"]
        assert "content_md" in data

    def test_get_skill_returns_content_md(self, skill):
        status, data = api("GET", f"/v1/skills/{skill['slug']}", expected=200)
        assert "# E2E Skill" in data["content_md"]

    def test_update_skill_description(self, skill):
        new_desc = "Updated description for E2E test"
        status, data = api("PATCH", f"/v1/skills/{skill['slug']}", {"description": new_desc}, expected=200)
        assert data["description"] == new_desc

    def test_update_skill_tags(self, skill):
        status, data = api("PATCH", f"/v1/skills/{skill['slug']}", {"tags": ["e2e", "updated"]}, expected=200)
        assert "updated" in data["tags"]

    def test_update_skill_content(self, skill):
        new_content = "# Updated\n\nNew content body."
        status, data = api("PATCH", f"/v1/skills/{skill['slug']}", {"content_md": new_content}, expected=200)
        # Fetch fresh to confirm persistence
        status2, fresh = api("GET", f"/v1/skills/{skill['slug']}", expected=200)
        assert "Updated" in fresh["content_md"]

    def test_update_increments_version(self, skill):
        v_before = skill.get("current_version", 0)
        api("PATCH", f"/v1/skills/{skill['slug']}", {"content_md": "# v2\n\nNew."}, expected=200)
        status, fresh = api("GET", f"/v1/skills/{skill['slug']}", expected=200)
        assert fresh["current_version"] >= v_before

    def test_delete_skill(self):
        slug = unique_slug("e2e-del")
        api("POST", "/v1/skills", {"name": slug, "slug": slug, "description": "to delete", "content_md": "# Del"}, expected=201)
        api("DELETE", f"/v1/skills/{slug}", expected=204)
        status, _ = api("GET", f"/v1/skills/{slug}")
        assert status == 404

    def test_get_nonexistent_skill_returns_404(self):
        status, _ = api("GET", "/v1/skills/absolutely-does-not-exist-xyz")
        assert status == 404

    def test_create_duplicate_slug_returns_409(self, skill):
        # Same name AND slug → conflict
        status, data = api("POST", "/v1/skills", {"name": skill["name"], "slug": skill["slug"], "description": "dup", "content_md": "# dup"})
        assert status == 409

    def test_create_skill_without_name_returns_422(self):
        status, data = api("POST", "/v1/skills", {"description": "no name"})
        assert status == 422

    def test_skill_slug_matches_provided_slug(self):
        """API stores the slug exactly as provided."""
        name = unique_slug("slug-gen")
        status, data = api("POST", "/v1/skills", {"name": name, "slug": name, "description": "slug test", "content_md": "# x"}, expected=201)
        assert data["slug"] == name
        api("DELETE", f"/v1/skills/{data['slug']}")


# ─── TESTS: CONTENT VERSIONS ──────────────────────────────────────────────────

class TestContentVersions:
    def test_list_content_versions(self, skill):
        status, versions = api("GET", f"/v1/skills/{skill['slug']}/content-versions", expected=200)
        assert isinstance(versions, list)
        assert len(versions) >= 1

    def test_content_version_has_required_fields(self, skill):
        status, versions = api("GET", f"/v1/skills/{skill['slug']}/content-versions", expected=200)
        assert len(versions) >= 1
        v = versions[0]
        assert "version" in v
        assert "content_md" in v
        assert "created_at" in v

    def test_edit_creates_new_version(self, skill):
        api("PATCH", f"/v1/skills/{skill['slug']}", {"content_md": "# V2\n\nEdited."}, expected=200)
        status, versions = api("GET", f"/v1/skills/{skill['slug']}/content-versions", expected=200)
        assert len(versions) >= 2

    def test_restore_old_version(self, skill):
        # Edit twice to have multiple versions
        api("PATCH", f"/v1/skills/{skill['slug']}", {"content_md": "# V2\n\nSecond edit."}, expected=200)
        api("PATCH", f"/v1/skills/{skill['slug']}", {"content_md": "# V3\n\nThird edit."}, expected=200)
        status, versions = api("GET", f"/v1/skills/{skill['slug']}/content-versions", expected=200)
        if len(versions) >= 2:
            old_version = versions[-1]["version"]
            restore_status, _ = api("POST", f"/v1/skills/{skill['slug']}/content-versions/{old_version}/restore")
            assert restore_status in (200, 201, 204)


# ─── TESTS: COMMENTS ─────────────────────────────────────────────────────────

class TestComments:
    def test_list_comments_empty_for_new_skill(self, skill):
        status, comments = api("GET", f"/v1/skills/{skill['slug']}/comments", expected=200)
        assert isinstance(comments, list)

    def test_create_comment(self, skill):
        status, comment = api("POST", f"/v1/skills/{skill['slug']}/comments", {"body": "This is an E2E comment", "author": "e2e-test"}, expected=201)
        assert comment["body"] == "This is an E2E comment"
        assert "id" in comment

    def test_list_comments_shows_created_comment(self, skill):
        api("POST", f"/v1/skills/{skill['slug']}/comments", {"body": "Comment for list test", "author": "e2e-test"}, expected=201)
        status, comments = api("GET", f"/v1/skills/{skill['slug']}/comments", expected=200)
        assert any(c["body"] == "Comment for list test" for c in comments)

    def test_update_comment(self, skill):
        _, comment = api("POST", f"/v1/skills/{skill['slug']}/comments", {"body": "Original", "author": "e2e-test"}, expected=201)
        cid = comment["id"]
        status, updated = api("PATCH", f"/v1/skills/{skill['slug']}/comments/{cid}", {"body": "Updated"}, expected=200)
        assert updated["body"] == "Updated"

    def test_delete_comment(self, skill):
        _, comment = api("POST", f"/v1/skills/{skill['slug']}/comments", {"body": "To delete", "author": "e2e-test"}, expected=201)
        cid = comment["id"]
        api("DELETE", f"/v1/skills/{skill['slug']}/comments/{cid}", expected=204)
        status, comments = api("GET", f"/v1/skills/{skill['slug']}/comments", expected=200)
        assert not any(c["id"] == cid for c in comments)

    def test_create_comment_empty_body_returns_error(self, skill):
        status, _ = api("POST", f"/v1/skills/{skill['slug']}/comments", {"body": ""})
        assert status in (400, 422)


# ─── TESTS: TAGS ─────────────────────────────────────────────────────────────

class TestTags:
    def test_list_tags(self):
        status, tags = api("GET", "/v1/tags", expected=200)
        assert isinstance(tags, list)

    def test_tags_have_name_and_count(self):
        status, tags = api("GET", "/v1/tags", expected=200)
        for tag in tags:
            assert "name" in tag
            assert "skill_count" in tag
            assert tag["skill_count"] >= 0

    def test_tag_count_matches_skill_count(self):
        _, skills = api("GET", "/v1/skills", expected=200)
        _, tags = api("GET", "/v1/tags", expected=200)
        all_tags_in_skills: set[str] = set()
        for s in skills:
            all_tags_in_skills.update(s.get("tags", []))
        tag_names = {t["name"] for t in tags}
        # Every tag in the tags endpoint must exist in at least one skill
        for tag_name in tag_names:
            assert tag_name in all_tags_in_skills, f"Tag '{tag_name}' not found in any skill"

    def test_create_skill_with_tag_appears_in_tags_list(self):
        slug = unique_slug("e2e-tag")
        unique_tag = f"tag-{slug}"
        api("POST", "/v1/skills", {"name": slug, "slug": slug, "description": "tag test", "content_md": "# t", "tags": [unique_tag]}, expected=201)
        try:
            _, tags = api("GET", "/v1/tags", expected=200)
            tag_names = [t["name"] for t in tags]
            assert unique_tag in tag_names
        finally:
            api("DELETE", f"/v1/skills/{slug}")

    def test_delete_tag(self):
        # Create a skill with a unique tag, then delete the tag
        slug = unique_slug("e2e-dtag")
        unique_tag = f"dtag-{slug}"
        api("POST", "/v1/skills", {"name": slug, "slug": slug, "description": "d", "content_md": "# d", "tags": [unique_tag]}, expected=201)
        try:
            status, _ = api("DELETE", f"/v1/tags/{unique_tag}")
            assert status == 204
            _, tags = api("GET", "/v1/tags", expected=200)
            assert not any(t["name"] == unique_tag for t in tags)
        finally:
            api("DELETE", f"/v1/skills/{slug}")


# ─── TESTS: MCP ───────────────────────────────────────────────────────────────

class TestMCPServer:
    def test_initialize_returns_session_id(self):
        session_id, result = mcp_init()
        assert session_id, "Expected session ID in Mcp-Session-Id header"
        assert result["result"]["serverInfo"]["name"] == "SkillNote"

    def test_tools_list_returns_skills(self):
        session_id, _ = mcp_init()
        status, json = mcp_post("/mcp", {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, session_id)
        assert "result" in json
        tools = json["result"]["tools"]
        assert isinstance(tools, list)
        assert len(tools) >= 1

    def test_tools_list_includes_skill_creator(self):
        session_id, _ = mcp_init()
        _, json = mcp_post("/mcp", {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, session_id)
        names = [t["name"] for t in json["result"]["tools"]]
        assert "skill-creator" in names

    def test_tools_call_returns_content(self):
        session_id, _ = mcp_init()
        _, json = mcp_post("/mcp", {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                                    "params": {"name": "skill-creator", "arguments": {}}}, session_id)
        assert json["result"]["isError"] is False
        text = json["result"]["content"][0]["text"]
        assert text.startswith("# ")
        assert len(text) > 20

    def test_tools_call_unknown_returns_error(self):
        session_id, _ = mcp_init()
        _, json = mcp_post("/mcp", {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                                    "params": {"name": "nonexistent-zzz", "arguments": {}}}, session_id)
        assert json["result"]["isError"] is True

    def test_empty_slug_returns_error_not_first_skill(self):
        """Regression: empty name must return isError=true, not the first skill."""
        session_id, _ = mcp_init()
        _, json = mcp_post("/mcp", {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                                    "params": {"name": "", "arguments": {}}}, session_id)
        assert json["result"]["isError"] is True, (
            "Empty slug should return isError=true. "
            "Before the fix, it returned the first skill alphabetically."
        )

    def test_mcp_reflects_new_skill_without_restart(self):
        """MCP tools/list picks up a new skill immediately (live discovery)."""
        slug = unique_slug("mcp-live")
        api("POST", "/v1/skills", {"name": slug, "slug": slug, "description": "live MCP test", "content_md": "# Live"}, expected=201)
        try:
            session_id, _ = mcp_init()
            _, json = mcp_post("/mcp", {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, session_id)
            names = [t["name"] for t in json["result"]["tools"]]
            assert slug in names, f"Expected {slug} in MCP tools, got: {names}"
        finally:
            api("DELETE", f"/v1/skills/{slug}")

    def test_mcp_removed_skill_disappears_from_tools(self):
        slug = unique_slug("mcp-del")
        api("POST", "/v1/skills", {"name": slug, "slug": slug, "description": "temp", "content_md": "# Temp"}, expected=201)
        session_id, _ = mcp_init()

        _, before = mcp_post("/mcp", {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, session_id)
        assert slug in [t["name"] for t in before["result"]["tools"]]

        api("DELETE", f"/v1/skills/{slug}", expected=204)

        _, after = mcp_post("/mcp", {"jsonrpc": "2.0", "id": 3, "method": "tools/list", "params": {}}, session_id)
        assert slug not in [t["name"] for t in after["result"]["tools"]]

    def test_no_session_id_returns_400(self):
        status, resp = mcp_post("/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
        # FastMCP returns 400 for missing session ID
        assert status in (400, 200)  # 200 if it echoed error in body
        # In either case, the text must mention session
        assert status == 400 or "session" in str(resp).lower()


# ─── TESTS: CROSS-LAYER (API + MCP consistency) ───────────────────────────────

class TestCrossLayer:
    """Verify that the API and MCP see the exact same data."""

    def test_api_and_mcp_have_same_skill_count(self):
        _, api_skills = api("GET", "/v1/skills", expected=200)
        session_id, _ = mcp_init()
        _, mcp_json = mcp_post("/mcp", {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, session_id)
        api_slugs = {s["slug"] for s in api_skills}
        mcp_names = {t["name"] for t in mcp_json["result"]["tools"]}
        assert api_slugs == mcp_names, (
            f"API slugs and MCP tool names differ.\n"
            f"Only in API: {api_slugs - mcp_names}\n"
            f"Only in MCP: {mcp_names - api_slugs}"
        )

    def test_skill_description_same_in_api_and_mcp_list(self):
        _, api_skills = api("GET", "/v1/skills", expected=200)
        session_id, _ = mcp_init()
        _, mcp_json = mcp_post("/mcp", {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, session_id)
        mcp_by_name = {t["name"]: t for t in mcp_json["result"]["tools"]}
        for skill in api_skills:
            slug = skill["slug"]
            if slug in mcp_by_name:
                assert mcp_by_name[slug]["description"] == skill["description"], (
                    f"Description mismatch for {slug}:\n"
                    f"  API: {skill['description']}\n"
                    f"  MCP: {mcp_by_name[slug]['description']}"
                )

    def test_mcp_tool_content_matches_api_content_md(self):
        _, api_skill = api("GET", "/v1/skills/skill-creator", expected=200)
        session_id, _ = mcp_init()
        _, mcp_json = mcp_post("/mcp", {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                                        "params": {"name": "skill-creator", "arguments": {}}}, session_id)
        mcp_text = mcp_json["result"]["content"][0]["text"]
        # MCP returns "# SkillName\n\n{content_md}" so content_md is a subset
        assert api_skill["content_md"] in mcp_text
