"""
SkillNote MCP Server

Exposes skills from the SkillNote database as MCP tools.
Each skill becomes a tool: name=slug, description=skill description.
Calling a tool returns the full SKILL.md content.

Filter skills via URL query params:
  ?collections=frontend,enterprise

Real-time notifications:
  When a skill is created, updated, or deleted (via the REST API), the API
  issues a PostgreSQL NOTIFY skillnote_skills_changed.  This server listens
  for that notification and broadcasts notifications/tools/list_changed to
  every currently connected MCP client so clients can re-fetch the tool list
  without reconnecting.
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

import mcp.types as mcp_types
logger = logging.getLogger(__name__)
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import JSONResponse

from fastmcp import FastMCP
from fastmcp.server.middleware import Middleware
from fastmcp.server.middleware.middleware import MiddlewareContext
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


# ── MCP session registry ──────────────────────────────────────────────────────
# Maps id(session) -> ServerSession for all currently initialised MCP sessions.
# Strong references kept here; entries are pruned when send_notification() fails
# (meaning the client has disconnected).
_session_registry: dict[int, Any] = {}


class SessionCapturingMiddleware(Middleware):
    """FastMCP middleware that registers every MCP session on initialize.

    Storing the ServerSession object lets broadcast_tools_changed() push
    notifications/tools/list_changed to every live client without polling.
    """

    async def on_initialize(
        self,
        context: MiddlewareContext,
        call_next,
    ):
        result = await call_next(context)
        if context.fastmcp_context and context.fastmcp_context.session is not None:
            session = context.fastmcp_context.session
            _session_registry[id(session)] = session
            logger.debug("Registered MCP session %d (total: %d)",
                         id(session), len(_session_registry))
        return result


async def broadcast_tools_changed() -> None:
    """Push notifications/tools/list_changed to every connected MCP client.

    Called whenever a skill is created, updated, or deleted.  Sessions that
    fail (disconnected clients) are removed from the registry automatically.
    """
    notification = mcp_types.ServerNotification(
        root=mcp_types.ToolListChangedNotification()
    )
    snapshot = list(_session_registry.items())
    if not snapshot:
        logger.debug("broadcast_tools_changed: no active sessions, skipping")
        return

    logger.info("Broadcasting notifications/tools/list_changed to %d session(s)",
                len(snapshot))
    stale: list[int] = []
    for key, session in snapshot:
        try:
            await session.send_notification(notification)
        except Exception:
            logger.debug("Session %d unreachable, marking stale", key, exc_info=True)
            stale.append(key)

    for key in stale:
        _session_registry.pop(key, None)

    if stale:
        logger.debug("Removed %d stale session(s) from registry", len(stale))


# ── PostgreSQL LISTEN/NOTIFY loop ─────────────────────────────────────────────

async def _pg_listen_loop() -> None:
    """Background coroutine: waits for PostgreSQL NOTIFY skillnote_skills_changed.

    The REST API sends a NOTIFY inside the same transaction as each skill
    create / update / delete, so this fires immediately after the commit.
    On receipt we broadcast notifications/tools/list_changed to all live clients.

    Connection errors use exponential back-off (2 s → 60 s max).
    """
    import psycopg  # type: ignore[import]

    # Convert SQLAlchemy URL to plain libpq URL for psycopg async
    pg_url = DATABASE_URL.replace("postgresql+psycopg", "postgresql", 1)

    retry_delay = 2.0
    while True:
        try:
            async with await psycopg.AsyncConnection.connect(
                pg_url, autocommit=True
            ) as aconn:
                await aconn.execute("LISTEN skillnote_skills_changed")
                logger.info(
                    "MCP server listening for skill changes via PostgreSQL NOTIFY"
                )
                retry_delay = 2.0  # reset after successful connect

                async for notify in aconn.notifies():
                    logger.debug(
                        "Received NOTIFY: channel=%s payload=%r",
                        notify.channel, notify.payload,
                    )
                    asyncio.create_task(
                        broadcast_tools_changed(),
                        name="broadcast-tools-changed",
                    )

        except asyncio.CancelledError:
            logger.info("PG listen loop cancelled, shutting down")
            break
        except Exception:
            logger.exception(
                "PG listen loop error; reconnecting in %.0f s", retry_delay
            )
            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 60.0)


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

            # ── 1. Parse body early — must happen before any branching ────────
            # Starlette caches request.body() so downstream handlers are unaffected.
            # Detecting `initialize` here lets every subsequent step behave correctly.
            is_initialize = False
            client_name, client_version, proto_version = "", "", ""
            if request.method == "POST" and not existing_sid:
                try:
                    data  = _json.loads(await request.body())
                    items = data if isinstance(data, list) else [data]
                    for item in items:
                        if isinstance(item, dict) and item.get("method") == "initialize":
                            is_initialize  = True
                            params         = item.get("params", {})
                            ci             = params.get("clientInfo", {})
                            client_name    = ci.get("name", "")    or ""
                            client_version = ci.get("version", "") or ""
                            proto_version  = params.get("protocolVersion", "") or ""
                            break
                except Exception:
                    pass

            # ── 1b. Detect tools/call for analytics (all POST /mcp requests) ──
            skill_call_slug: str | None = None
            if request.method == "POST":
                try:
                    data = _json.loads(await request.body())
                    items = data if isinstance(data, list) else [data]
                    for item in items:
                        if isinstance(item, dict) and item.get("method") == "tools/call":
                            skill_call_slug = item.get("params", {}).get("name")
                            break
                except Exception:
                    pass

            # ── 2. Session termination ────────────────────────────────────────
            if request.method == "DELETE" and existing_sid:
                _active_connections.pop(existing_sid, None)
                return await call_next(request)

            # ── 3. Update known session by Mcp-Session-Id header ─────────────
            if existing_sid and existing_sid in _active_connections:
                sess = _active_connections[existing_sid]
                sess["last_seen"]  = time.time()
                sess["call_count"] = sess.get("call_count", 0) + 1

            # ── 3b. Unknown session ID — server restarted, client still alive ──
            # Client is sending an Mcp-Session-Id we've never seen (our in-memory
            # dict was wiped). Re-register it under the existing ID so the client's
            # calls show up in the live view without requiring a reconnect.
            elif existing_sid and existing_sid not in _active_connections and not is_initialize:
                _active_connections[existing_sid] = _make_session(
                    existing_sid, ua, remote, scope, "", "", "",
                )

            # ── 4. IP+UA fallback (non-initialize only) ───────────────────────
            # Clients that don't echo Mcp-Session-Id (curl, some libs) still
            # keep their session alive via fingerprinting.
            elif not existing_sid and not is_initialize:
                match = max(
                    (s for s in _active_connections.values()
                     if s.get("remote") == remote and s.get("user_agent") == ua),
                    key=lambda s: s.get("last_seen", 0),
                    default=None,
                )
                if match:
                    match["last_seen"]  = time.time()
                    match["call_count"] = match.get("call_count", 0) + 1

            # ── 5. Pre-create session for initialize ──────────────────────────
            # Create BEFORE call_next so the entry exists regardless of whether
            # the server returns Mcp-Session-Id in the response headers.
            # On reconnect: remove any previous sessions from the same client
            # (same remote+ua+client_name) so we don't accumulate orphans.
            pre_sid: str | None = None
            if is_initialize:
                stale = [
                    sid for sid, s in _active_connections.items()
                    if (s.get("remote") == remote
                        and s.get("user_agent") == ua
                        and s.get("client_name", "") == client_name)
                ]
                for sid in stale:
                    _active_connections.pop(sid, None)

                pre_sid = str(uuid.uuid4())
                _active_connections[pre_sid] = _make_session(
                    pre_sid, ua, remote, scope,
                    client_name, client_version, proto_version,
                )

            response = await call_next(request)

            # ── 5b. Log analytics for tools/call ─────────────────────────────
            if skill_call_slug:
                resolved_sid = existing_sid or pre_sid or ""
                sess_for_log = _active_connections.get(resolved_sid)
                asyncio.create_task(_log_event(skill_call_slug, sess_for_log, scope, remote))

            # ── 6. Migrate pre-created entry to real Mcp-Session-Id ───────────
            # If the server returned a session ID, rename our pre-created entry
            # so subsequent requests (which carry that ID) match correctly.
            new_sid = response.headers.get("mcp-session-id")
            if new_sid:
                if pre_sid and pre_sid in _active_connections:
                    entry = _active_connections.pop(pre_sid)
                    entry["id"] = new_sid
                    _active_connections[new_sid] = entry
                elif new_sid not in _active_connections:
                    # Server returned session ID but we didn't detect initialize
                    # (e.g. body parse failed) — register now as fallback.
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


def _log_event_sync(skill_slug: str, agent_name: str, agent_version: str,
                     session_id: str, collection_scope: str | None, remote_ip: str) -> None:
    import uuid as _uuid
    try:
        with Session(engine) as db:
            db.execute(
                text("""INSERT INTO skill_call_events
                    (id, skill_slug, event_type, agent_name, agent_version, session_id, collection_scope, remote_ip)
                    VALUES (:id, :slug, 'called', :agent, :version, :session, :scope, :remote)"""),
                {
                    "id": str(_uuid.uuid4()),
                    "slug": skill_slug,
                    "agent": agent_name,
                    "version": agent_version,
                    "session": session_id,
                    "scope": collection_scope,
                    "remote": remote_ip,
                }
            )
            db.commit()
    except Exception:
        logger.exception("Failed to log skill call event")


async def _log_event(skill_slug: str, session_meta: dict | None, scope: str | None, remote: str) -> None:
    agent_name = ""
    agent_version = ""
    session_id = ""
    if session_meta:
        agent_name = session_meta.get("client_name", "")
        agent_version = session_meta.get("client_version", "")
        session_id = session_meta.get("id", "")
    await asyncio.to_thread(_log_event_sync, skill_slug, agent_name, agent_version, session_id, scope, remote)


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

# Register the session-capturing middleware so every initialized session is
# stored in _session_registry and can receive tool-change notifications.
mcp.add_middleware(SessionCapturingMiddleware())


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
    from contextlib import asynccontextmanager as _acm
    from starlette.middleware import Middleware

    http_app = mcp.http_app(transport="http")
    http_app.add_middleware(ConnectionTrackerMiddleware)

    # Wrap the existing lifespan so that the PostgreSQL NOTIFY listener
    # runs for the full lifetime of the server process.
    _original_lifespan = http_app.router.lifespan_context

    @_acm
    async def _lifespan_with_pg(app):
        pg_task = asyncio.create_task(_pg_listen_loop(), name="pg-listener")
        try:
            async with _original_lifespan(app):
                yield
        finally:
            pg_task.cancel()
            try:
                await pg_task
            except asyncio.CancelledError:
                pass

    http_app.router.lifespan_context = _lifespan_with_pg

    uvicorn.run(http_app, host="0.0.0.0", port=8083)
