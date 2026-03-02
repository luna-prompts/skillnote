"""
SkillNote MCP Server

Exposes skills from the SkillNote database as MCP tools.
Each skill becomes a tool: name=slug, description=skill description.
Calling a tool returns the full SKILL.md content.

Filter skills via URL query params:
  ?collections=frontend,enterprise
  ?tags=security,testing
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Sequence
from typing import Any

logger = logging.getLogger(__name__)
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from fastmcp import FastMCP
from fastmcp.server.providers import Provider
from fastmcp.tools.tool import Tool, ToolResult

DATABASE_URL = os.environ.get(
    "SKILLNOTE_DATABASE_URL",
    "postgresql+psycopg://skillnote:skillnote@localhost:5432/skillnote",
)

engine = create_engine(
    DATABASE_URL,
    future=True,
    pool_pre_ping=True,
    connect_args={"connect_timeout": 5},
)


class SkillTool(Tool):
    """A tool that returns SKILL.md content for a specific skill."""

    skill_slug: str
    content_md: str
    skill_name: str

    async def run(self, arguments: dict[str, Any]) -> ToolResult:
        return ToolResult(content=f"# {self.skill_name}\n\n{self.content_md}")


class SkillNoteToolProvider(Provider):
    """Queries PostgreSQL for skills, optionally filtered by collections/tags.

    Called on every list_tools/get_tool request so database changes
    are reflected immediately without server restart.
    """

    def __init__(self, db_engine):
        super().__init__()
        self.engine = db_engine

    def _parse_filters(self) -> tuple[list[str], list[str]]:
        """Extract collections and tags filters from the MCP connection URL.

        FastMCP passes query params through the transport layer. We parse
        the SKILLNOTE_MCP_FILTER_* env vars as a fallback for testing.
        """
        collections = []
        tags = []
        filter_collections = os.environ.get("SKILLNOTE_MCP_FILTER_COLLECTIONS", "")
        filter_tags = os.environ.get("SKILLNOTE_MCP_FILTER_TAGS", "")
        if filter_collections:
            collections = [c.strip() for c in filter_collections.split(",") if c.strip()]
        if filter_tags:
            tags = [t.strip() for t in filter_tags.split(",") if t.strip()]
        return collections, tags

    def _build_query(self, collections: list[str], tags: list[str], slug: str | None = None):
        """Build a SQL query for skills with optional filters."""
        conditions = []
        params: dict[str, Any] = {}

        if slug is not None:
            conditions.append("slug = :slug")
            params["slug"] = slug

        if collections:
            conditions.append("collections && :collections")
            params["collections"] = collections

        if tags:
            conditions.append("tags && :tags")
            params["tags"] = tags

        where = ""
        if conditions:
            where = "WHERE " + " AND ".join(conditions)

        query = text(
            f"SELECT slug, name, description, content_md, tags, collections "
            f"FROM skills {where} ORDER BY name"
        )
        return query, params

    def _fetch_skills(self, slug: str | None = None) -> list[dict]:
        """Fetch skills from the database."""
        collections, tags = self._parse_filters()
        query, params = self._build_query(collections, tags, slug)

        try:
            with Session(self.engine) as session:
                result = session.execute(query, params)
                rows = result.mappings().all()
                return [dict(row) for row in rows]
        except Exception:
            logger.exception("DB error fetching skills (slug=%r)", slug)
            raise

    def _to_tool(self, skill: dict) -> SkillTool:
        return SkillTool(
            name=skill["slug"],
            description=skill["description"] or "",
            parameters={"type": "object", "properties": {}},
            skill_slug=skill["slug"],
            skill_name=skill["name"],
            content_md=skill["content_md"] or "",
        )

    async def _list_tools(self) -> Sequence[Tool]:
        skills = await asyncio.to_thread(self._fetch_skills)
        return [self._to_tool(s) for s in skills]

    async def _get_tool(self, name: str, version=None) -> Tool | None:
        skills = await asyncio.to_thread(self._fetch_skills, name)
        return self._to_tool(skills[0]) if skills else None


provider = SkillNoteToolProvider(db_engine=engine)

mcp = FastMCP(
    name="SkillNote",
    instructions=(
        "This server provides AI skills from a SkillNote registry. "
        "Each tool represents a skill — call it when the user's task matches its description. "
        "The tool returns detailed instructions you should follow. "
        "After using a skill, check if other available skills might also help with the task."
    ),
    providers=[provider],
)

if __name__ == "__main__":
    mcp.run(transport="http", host="0.0.0.0", port=8083)
