"""
SkillNote MCP Server

Exposes skills from the SkillNote database as MCP tools.
Each skill becomes a tool: name=slug, description=skill description.
Calling a tool returns the full SKILL.md content.

Filter skills via URL query params:
  ?collections=frontend,enterprise
"""

from __future__ import annotations

import asyncio
import json as _json
import logging
import os
import time
import uuid
from collections.abc import Sequence
from typing import Any

logger = logging.getLogger(__name__)
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import JSONResponse

from fastmcp import FastMCP
from fastmcp.server.providers import Provider
from fastmcp.tools.tool import Tool, ToolResult

# ── connection tracking ───────────────────────────────────────────────────────

_server_start: float = time.time()

# session_id -> {id, connected_at, last_seen, user_agent, remote, scope, ...}
_active_connections: dict[str, dict] = {}

# Sessions idle longer than this are considered disconnected.
# 30 minutes — Claude Code initializes once at startup and may sit idle
# for a long time before the user actually invokes a skill.
SESSION_TIMEOUT = 1800  # seconds


def _make_session(sid: str, ua: str, remote: str, scope: str | None,
                  client_name: str, client_version: str, proto_version: str) -> dict:
    now = time.time()
    return {
        "id": sid,
        "connected_at": now,
        "last_seen": now,
        "user_agent": ua,
        "remote": remote,
        "scope": scope,
        "client_name": client_name,
        "client_version": client_version,
        "proto_version": proto_version,
        "call_count": 0,
    }


class ConnectionTrackerMiddleware(BaseHTTPMiddleware):
    """Tracks MCP sessions for both streamable-http and SSE transports.

    Streamable-http (POST /mcp):
      - On initialize: pre-create session immediately from request body so we
        don't depend on the response header arriving before a timeout fires.
        If the server returns Mcp-Session-Id, migrate the entry to that ID.
      - On subsequent calls: update last_seen via Mcp-Session-Id header first,
        then fall back to (remote, ua) fingerprint for clients that omit the
        header.
      - On DELETE: remove session immediately.
      - Idle sessions expire after SESSION_TIMEOUT (30 min) via /status.

    SSE (/sse): genuine long-lived TCP connection — track for its lifetime.
    """

    async def dispatch(self, request: StarletteRequest, call_next):
        path = request.url.path.rstrip("/")

        # ── SSE: genuine persistent connection ──────────────────────────────
        if path == "/sse":
            conn_id = str(uuid.uuid4())
            ua     = request.headers.get("user-agent", "")
            remote = request.client.host if request.client else "unknown"
            _active_connections[conn_id] = _make_session(
                conn_id, ua, remote,
                request.query_params.get("collections") or None,
                "", "", "",
            )
            try:
                return await call_next(request)
            finally:
                _active_connections.pop(conn_id, None)

        # ── streamable-http: session-based tracking ──────────────────────────
        if path == "/mcp":
            ua     = request.headers.get("user-agent", "")
            remote = request.client.host if request.client else "unknown"
            scope  = request.query_params.get("collections") or None
            existing_sid = request.headers.get("mcp-session-id")

            # 1. Update known session by header
            if existing_sid and existing_sid in _active_connections:
                sess = _active_connections[existing_sid]
                sess["last_seen"]  = time.time()
                sess["call_count"] = sess.get("call_count", 0) + 1

            # 2. Fallback: match by (remote, ua) for clients that omit the header
            elif not existing_sid:
                for sess in _active_connections.values():
                    if sess.get("remote") == remote and sess.get("user_agent") == ua:
                        sess["last_seen"]  = time.time()
                        sess["call_count"] = sess.get("call_count", 0) + 1
                        break

            # 3. Session termination
            if request.method == "DELETE" and existing_sid:
                _active_connections.pop(existing_sid, None)
                return await call_next(request)

            # 4. Detect initialize and pre-create session BEFORE call_next
            #    so the entry exists even if the response header is never read.
            client_name, client_version, proto_version = "", "", ""
            pre_sid: str | None = None
            if request.method == "POST" and not existing_sid:
                try:
                    data  = _json.loads(await request.body())
                    items = data if isinstance(data, list) else [data]
                    for item in items:
                        if isinstance(item, dict) and item.get("method") == "initialize":
                            params = item.get("params", {})
                            ci     = params.get("clientInfo", {})
                            client_name    = ci.get("name", "") or ""
                            client_version = ci.get("version", "") or ""
                            proto_version  = params.get("protocolVersion", "") or ""
                            pre_sid = str(uuid.uuid4())
                            _active_connections[pre_sid] = _make_session(
                                pre_sid, ua, remote, scope,
                                client_name, client_version, proto_version,
                            )
                            break
                except Exception:
                    pass

            response = await call_next(request)

            # 5. Migrate pre-created entry to the real Mcp-Session-Id if available
            new_sid = response.headers.get("mcp-session-id")
            if new_sid:
                if pre_sid and pre_sid in _active_connections:
                    entry = _active_connections.pop(pre_sid)
                    entry["id"] = new_sid
                    _active_connections[new_sid] = entry
                elif new_sid not in _active_connections:
                    _active_connections[new_sid] = _make_session(
                        new_sid, ua, remote, scope,
                        client_name, client_version, proto_version,
                    )

            return response

        return await call_next(request)


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
    """Queries PostgreSQL for skills, optionally filtered by collections.

    Called on every list_tools/get_tool request so database changes
    are reflected immediately without server restart.
    """

    def __init__(self, db_engine):
        super().__init__()
        self.engine = db_engine

    def _parse_filters(self) -> list[str]:
        """Extract collections filter from the MCP connection URL.

        FastMCP passes query params through the transport layer. We parse
        the SKILLNOTE_MCP_FILTER_* env vars as a fallback for testing.
        """
        collections = []
        filter_collections = os.environ.get("SKILLNOTE_MCP_FILTER_COLLECTIONS", "")
        if filter_collections:
            collections = [c.strip() for c in filter_collections.split(",") if c.strip()]
        return collections

    def _build_query(self, collections: list[str], slug: str | None = None):
        """Build a SQL query for skills with optional filters."""
        conditions = []
        params: dict[str, Any] = {}

        if slug is not None:
            conditions.append("slug = :slug")
            params["slug"] = slug

        if collections:
            conditions.append("collections && :collections")
            params["collections"] = collections

        where = ""
        if conditions:
            where = "WHERE " + " AND ".join(conditions)

        query = text(
            f"SELECT slug, name, description, content_md, collections "
            f"FROM skills {where} ORDER BY name"
        )
        return query, params

    def _fetch_skills(self, slug: str | None = None) -> list[dict]:
        """Fetch skills from the database."""
        collections = self._parse_filters()
        query, params = self._build_query(collections, slug)

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


@mcp.custom_route("/status", methods=["GET"])
async def status_endpoint(request: StarletteRequest) -> JSONResponse:
    """Returns server uptime, active connection count, and per-connection info."""
    now = time.time()

    # Expire sessions that have been idle longer than SESSION_TIMEOUT
    stale = [sid for sid, c in _active_connections.items() if now - c["last_seen"] > SESSION_TIMEOUT]
    for sid in stale:
        _active_connections.pop(sid, None)

    connections = [
        {
            **c,
            "duration_seconds": int(now - c["connected_at"]),
        }
        for c in _active_connections.values()
    ]
    return JSONResponse(
        {
            "status": "online",
            "uptime_seconds": int(now - _server_start),
            "active_connections": len(connections),
            "connections": connections,
        },
        headers={"Access-Control-Allow-Origin": "*"},
    )


if __name__ == "__main__":
    import uvicorn
    from starlette.middleware import Middleware

    http_app = mcp.http_app(transport="http")
    http_app.add_middleware(ConnectionTrackerMiddleware)
    uvicorn.run(http_app, host="0.0.0.0", port=8083)
