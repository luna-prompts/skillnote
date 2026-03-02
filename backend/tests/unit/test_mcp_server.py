"""
Unit tests for the SkillNote MCP server.

Tests cover:
- _build_query: slug/collections filter combinations
- _parse_filters: env-var parsing
- _to_tool: field mapping and NULL handling
- _fetch_skills: empty-string slug bug (was: `if slug:` → now `if slug is not None:`)
- _get_tool / _list_tools: async wrappers
- ToolResult format
"""

from __future__ import annotations

import asyncio
import os
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_provider():
    """Return a SkillNoteToolProvider with a real (in-process) SQLite engine
    so tests don't need Postgres.  We only test logic, not SQL dialect quirks.

    StaticPool + check_same_thread=False ensures asyncio.to_thread uses the
    same in-memory database rather than spawning a fresh connection each time
    (which would see an empty DB).
    """
    from mcp_server import SkillNoteToolProvider

    engine = create_engine(
        "sqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE skills (
                slug TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                content_md TEXT DEFAULT '',
                collections TEXT DEFAULT '{}'
            )
        """))
        conn.commit()
    return SkillNoteToolProvider(db_engine=engine), engine


def insert_skill(engine, slug, name="Skill Name", description="desc",
                 content_md="## content", collections="[]"):
    with engine.connect() as conn:
        conn.execute(text(
            "INSERT INTO skills (slug, name, description, content_md, collections) "
            "VALUES (:slug, :name, :desc, :content, :collections)"
        ), {"slug": slug, "name": name, "desc": description,
            "content": content_md, "collections": collections})
        conn.commit()


# ---------------------------------------------------------------------------
# _build_query
# ---------------------------------------------------------------------------

class TestBuildQuery:
    def setup_method(self):
        from mcp_server import SkillNoteToolProvider
        self.p = SkillNoteToolProvider(db_engine=MagicMock())

    def test_no_filters_no_slug(self):
        q, params = self.p._build_query([], None)
        sql = str(q)
        assert "WHERE" not in sql
        assert params == {}

    def test_slug_filter_added(self):
        q, params = self.p._build_query([], "my-slug")
        assert "slug = :slug" in str(q)
        assert params["slug"] == "my-slug"

    def test_empty_string_slug_adds_filter(self):
        """BUG FIX: empty string '' must still produce WHERE slug = :slug,
        not be treated as falsy and skipped."""
        q, params = self.p._build_query([], "")
        assert "slug = :slug" in str(q), (
            "Empty string slug should still add a slug condition — "
            "if slug: skips it, if slug is not None: does not"
        )
        assert params["slug"] == ""

    def test_none_slug_no_filter(self):
        q, params = self.p._build_query([], None)
        # The SELECT clause contains "slug" as a column name; we only check
        # that no WHERE condition on slug was injected.
        assert "slug = :slug" not in str(q)
        assert "slug" not in params

    def test_collections_filter(self):
        q, params = self.p._build_query(["devops"], None)
        assert "collections" in str(q)
        assert params["collections"] == ["devops"]

    def test_slug_and_collections_combined(self):
        q, params = self.p._build_query(["devops"], "my-slug")
        sql = str(q)
        assert "slug = :slug" in sql
        assert "collections" in sql
        assert params["slug"] == "my-slug"
        assert params["collections"] == ["devops"]

    def test_order_by_always_present(self):
        q, _ = self.p._build_query([], None)
        assert "ORDER BY name" in str(q)


# ---------------------------------------------------------------------------
# _parse_filters
# ---------------------------------------------------------------------------

class TestParseFilters:
    def setup_method(self):
        from mcp_server import SkillNoteToolProvider
        self.p = SkillNoteToolProvider(db_engine=MagicMock())

    def test_no_env_vars(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SKILLNOTE_MCP_FILTER_COLLECTIONS", None)
            colls = self.p._parse_filters()
        assert colls == []

    def test_collections_parsed(self):
        with patch.dict(os.environ, {"SKILLNOTE_MCP_FILTER_COLLECTIONS": "frontend,backend"}):
            colls = self.p._parse_filters()
        assert colls == ["frontend", "backend"]

    def test_whitespace_stripped(self):
        with patch.dict(os.environ, {"SKILLNOTE_MCP_FILTER_COLLECTIONS": " a , b , c "}):
            colls = self.p._parse_filters()
        assert colls == ["a", "b", "c"]

    def test_empty_string_env_var_returns_empty_list(self):
        with patch.dict(os.environ, {"SKILLNOTE_MCP_FILTER_COLLECTIONS": ""}):
            colls = self.p._parse_filters()
        assert colls == []

    def test_trailing_comma_ignored(self):
        with patch.dict(os.environ, {"SKILLNOTE_MCP_FILTER_COLLECTIONS": "admin,"}):
            colls = self.p._parse_filters()
        assert colls == ["admin"]


# ---------------------------------------------------------------------------
# _to_tool
# ---------------------------------------------------------------------------

class TestToTool:
    def setup_method(self):
        from mcp_server import SkillNoteToolProvider
        self.p = SkillNoteToolProvider(db_engine=MagicMock())

    def test_basic_mapping(self):
        skill = {"slug": "my-skill", "name": "My Skill",
                 "description": "A skill", "content_md": "## Hello"}
        tool = self.p._to_tool(skill)
        assert tool.name == "my-skill"
        assert tool.description == "A skill"
        assert tool.skill_name == "My Skill"
        assert tool.content_md == "## Hello"

    def test_null_content_md_becomes_empty_string(self):
        skill = {"slug": "s", "name": "S", "description": "d", "content_md": None}
        tool = self.p._to_tool(skill)
        assert tool.content_md == ""

    def test_null_description_becomes_empty_string(self):
        skill = {"slug": "s", "name": "S", "description": None, "content_md": "x"}
        tool = self.p._to_tool(skill)
        assert tool.description == ""

    def test_empty_string_content_md_preserved(self):
        skill = {"slug": "s", "name": "S", "description": "d", "content_md": ""}
        tool = self.p._to_tool(skill)
        assert tool.content_md == ""

    def test_parameters_schema_is_empty_object(self):
        skill = {"slug": "s", "name": "S", "description": "d", "content_md": "x"}
        tool = self.p._to_tool(skill)
        assert tool.parameters == {"type": "object", "properties": {}}

    def test_slug_used_as_tool_name_not_human_name(self):
        skill = {"slug": "the-slug", "name": "Human Name",
                 "description": "d", "content_md": "x"}
        tool = self.p._to_tool(skill)
        assert tool.name == "the-slug"
        assert tool.skill_name == "Human Name"


# ---------------------------------------------------------------------------
# _fetch_skills (using SQLite in-memory)
# ---------------------------------------------------------------------------

class TestFetchSkills:
    def setup_method(self):
        self.provider, self.engine = make_provider()

    def test_empty_db_returns_empty_list(self):
        result = self.provider._fetch_skills()
        assert result == []

    def test_returns_all_skills_when_no_slug(self):
        insert_skill(self.engine, "a")
        insert_skill(self.engine, "b")
        result = self.provider._fetch_skills()
        slugs = [r["slug"] for r in result]
        assert "a" in slugs
        assert "b" in slugs

    def test_slug_filter_returns_matching_skill(self):
        insert_skill(self.engine, "target", name="Target")
        insert_skill(self.engine, "other", name="Other")
        result = self.provider._fetch_skills(slug="target")
        assert len(result) == 1
        assert result[0]["slug"] == "target"

    def test_slug_filter_returns_empty_for_missing_slug(self):
        insert_skill(self.engine, "exists")
        result = self.provider._fetch_skills(slug="does-not-exist")
        assert result == []

    def test_empty_string_slug_returns_empty_not_all(self):
        """Core bug regression: _fetch_skills('') must not return all rows.

        Old code used `if slug:` which treated '' as falsy → no WHERE clause →
        all rows returned.  Fixed to `if slug is not None:` so '' produces
        WHERE slug = '' which matches nothing.
        """
        insert_skill(self.engine, "skill-a")
        insert_skill(self.engine, "skill-b")
        result = self.provider._fetch_skills(slug="")
        assert result == [], (
            "Empty string slug should return [] (no skill has slug=''), "
            "not all skills in the database"
        )

    def test_none_slug_returns_all(self):
        insert_skill(self.engine, "x")
        insert_skill(self.engine, "y")
        result = self.provider._fetch_skills(slug=None)
        assert len(result) == 2

    def test_result_ordered_by_name(self):
        insert_skill(self.engine, "z-slug", name="Zebra")
        insert_skill(self.engine, "a-slug", name="Apple")
        result = self.provider._fetch_skills()
        assert result[0]["name"] == "Apple"
        assert result[1]["name"] == "Zebra"

    def test_db_error_is_logged_and_reraised(self, caplog):
        """When the DB raises, the exception must be re-raised (not swallowed)
        and a log entry must be written."""
        import logging
        from sqlalchemy.exc import OperationalError

        # Break the engine with a bad URL
        bad_engine = create_engine(
            "sqlite:////nonexistent/path/that/cannot/exist/db.sqlite",
            future=True,
        )
        from mcp_server import SkillNoteToolProvider
        p = SkillNoteToolProvider(db_engine=bad_engine)

        with caplog.at_level(logging.ERROR, logger="mcp_server"):
            with pytest.raises(Exception):
                p._fetch_skills()

        assert any("DB error" in r.message for r in caplog.records), (
            "Expected a 'DB error' log entry when fetch fails"
        )


# ---------------------------------------------------------------------------
# SkillTool.run
# ---------------------------------------------------------------------------

class TestSkillToolRun:
    def test_run_returns_tool_result_with_formatted_content(self):
        from mcp_server import SkillTool
        tool = SkillTool(
            name="my-skill",
            description="desc",
            parameters={"type": "object", "properties": {}},
            skill_slug="my-skill",
            skill_name="My Skill",
            content_md="## Steps\n1. Do thing",
        )
        result = asyncio.get_event_loop().run_until_complete(tool.run({}))
        text = result.content[0].text if hasattr(result.content[0], "text") else str(result.content[0])
        assert "# My Skill" in text
        assert "## Steps" in text

    def test_run_with_empty_content_md(self):
        from mcp_server import SkillTool
        tool = SkillTool(
            name="s", description="d",
            parameters={"type": "object", "properties": {}},
            skill_slug="s", skill_name="S", content_md="",
        )
        result = asyncio.get_event_loop().run_until_complete(tool.run({}))
        text = result.content[0].text if hasattr(result.content[0], "text") else str(result.content[0])
        assert text == "# S\n\n"

    def test_run_ignores_extra_arguments(self):
        """SkillTool takes no params; extra arguments must be silently ignored."""
        from mcp_server import SkillTool
        tool = SkillTool(
            name="s", description="d",
            parameters={"type": "object", "properties": {}},
            skill_slug="s", skill_name="S", content_md="content",
        )
        result = asyncio.get_event_loop().run_until_complete(
            tool.run({"unexpected": "value", "another": 42})
        )
        assert result is not None


# ---------------------------------------------------------------------------
# async _list_tools / _get_tool (mocked _fetch_skills)
#
# asyncio.to_thread spawns threads; SQLite in-memory is per-connection so we
# mock _fetch_skills to avoid threading/DB issues here.  The real DB path is
# already covered by TestFetchSkills above.
# ---------------------------------------------------------------------------

SAMPLE_SKILLS = [
    {"slug": "alpha", "name": "Alpha", "description": "a", "content_md": "## Alpha"},
    {"slug": "beta",  "name": "Beta",  "description": "b", "content_md": "## Beta"},
]


class TestAsyncProviderMethods:
    def setup_method(self):
        from mcp_server import SkillNoteToolProvider
        self.provider = SkillNoteToolProvider(db_engine=MagicMock())

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_list_tools_empty_db(self):
        self.provider._fetch_skills = MagicMock(return_value=[])
        tools = self._run(self.provider._list_tools())
        assert tools == []

    def test_list_tools_returns_all_skills(self):
        self.provider._fetch_skills = MagicMock(return_value=SAMPLE_SKILLS)
        tools = self._run(self.provider._list_tools())
        names = [t.name for t in tools]
        assert "alpha" in names
        assert "beta" in names

    def test_list_tools_calls_fetch_with_no_slug(self):
        self.provider._fetch_skills = MagicMock(return_value=[])
        self._run(self.provider._list_tools())
        self.provider._fetch_skills.assert_called_once_with()

    def test_get_tool_returns_correct_skill(self):
        target = [{"slug": "target", "name": "Target Skill",
                   "description": "d", "content_md": "## hi"}]
        self.provider._fetch_skills = MagicMock(return_value=target)
        tool = self._run(self.provider._get_tool("target"))
        assert tool is not None
        assert tool.name == "target"
        assert tool.skill_name == "Target Skill"
        self.provider._fetch_skills.assert_called_once_with("target")

    def test_get_tool_returns_none_for_missing_slug(self):
        self.provider._fetch_skills = MagicMock(return_value=[])
        tool = self._run(self.provider._get_tool("missing"))
        assert tool is None

    def test_get_tool_empty_string_fetch_called_with_empty_string(self):
        """Regression: _get_tool('') must call _fetch_skills('') (not _fetch_skills(None))
        so the empty-slug WHERE clause is triggered and no rows are returned."""
        self.provider._fetch_skills = MagicMock(return_value=[])
        tool = self._run(self.provider._get_tool(""))
        # _fetch_skills must have been called with "" not with None
        self.provider._fetch_skills.assert_called_once_with("")
        assert tool is None

    def test_get_tool_none_returns_none(self):
        self.provider._fetch_skills = MagicMock(return_value=[])
        tool = self._run(self.provider._get_tool(None))
        assert tool is None

    def test_list_tools_converts_all_rows_to_skill_tools(self):
        self.provider._fetch_skills = MagicMock(return_value=SAMPLE_SKILLS)
        tools = self._run(self.provider._list_tools())
        assert len(tools) == 2
        from mcp_server import SkillTool
        for t in tools:
            assert isinstance(t, SkillTool)
