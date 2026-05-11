"""CLI ↔ Web bridge endpoints.

Lets the web UI dispatch jobs (e.g., "connect Claude Code") that an attached
local CLI claims and executes, streaming progress back so the browser can
render live status.

The model is intentionally tiny:
  POST   /v1/cli/jobs                   - Web UI creates a job
  GET    /v1/cli/jobs/pending           - CLI long-polls for next pending job
  POST   /v1/cli/jobs/{job_id}/claim    - CLI claims a job (idempotent)
  POST   /v1/cli/jobs/{job_id}/log      - CLI appends a log line
  POST   /v1/cli/jobs/{job_id}/done     - CLI reports completion
  GET    /v1/cli/jobs/{job_id}          - Web UI polls for status + log

Storage is in-process memory. Jobs older than 30 minutes are GC'd on every
read. This is appropriate because:
  - jobs are ephemeral, single-machine, user-initiated
  - no horizontal scaling is contemplated for local self-host
  - persistence would force schema migrations for transient state
"""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/v1/cli", tags=["cli-bridge"])


JobStatus = Literal["pending", "running", "succeeded", "failed", "cancelled"]
JobType = Literal["connect", "disconnect", "reconnect", "open"]


@dataclass
class Job:
    id: str
    type: JobType
    agent: str
    status: JobStatus = "pending"
    log: list = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    claimed_at: Optional[float] = None
    finished_at: Optional[float] = None
    exit_code: Optional[int] = None
    error: Optional[str] = None


# In-memory job store. Single-process; the API runs in one container.
_jobs: dict[str, Job] = {}
_pending_event = asyncio.Event()
_JOB_TTL_SECONDS = 30 * 60  # 30 min


def _gc() -> None:
    """Drop jobs older than the TTL; called opportunistically."""
    now = time.time()
    stale = [
        jid
        for jid, j in _jobs.items()
        if j.finished_at is not None and now - j.finished_at > _JOB_TTL_SECONDS
    ]
    for jid in stale:
        _jobs.pop(jid, None)


@router.post("/jobs", status_code=201)
async def create_job(body: dict) -> dict:
    _gc()
    job_type = body.get("type")
    agent = body.get("agent", "")
    if job_type not in ("connect", "disconnect", "reconnect", "open"):
        raise HTTPException(400, detail={"error": {"code": "INVALID_JOB_TYPE", "message": f"unknown type: {job_type}"}})
    if not isinstance(agent, str) or not agent:
        raise HTTPException(400, detail={"error": {"code": "INVALID_AGENT", "message": "agent is required"}})

    job_id = uuid.uuid4().hex
    _jobs[job_id] = Job(id=job_id, type=job_type, agent=agent)
    _pending_event.set()  # wake any waiting CLI
    return _serialize(_jobs[job_id])


@router.get("/jobs/pending")
async def claim_pending(timeout: float = Query(25.0, ge=0, le=60)) -> Optional[dict]:
    """Long-poll for the oldest pending job. Returns null on timeout.

    The CLI uses this in a loop: it gets a 25s window per request, then
    re-establishes. Pending jobs surface immediately via the asyncio.Event;
    if none arrive within `timeout`, the response is null.
    """
    _gc()
    deadline = time.time() + timeout
    while True:
        pending = _next_pending()
        if pending is not None:
            return _serialize(pending)
        remaining = deadline - time.time()
        if remaining <= 0:
            return None
        # Reset the event before waiting so we only wake on NEW jobs.
        _pending_event.clear()
        try:
            await asyncio.wait_for(_pending_event.wait(), timeout=remaining)
        except asyncio.TimeoutError:
            return None


@router.post("/jobs/{job_id}/claim")
async def claim_job(job_id: str) -> dict:
    job = _require(job_id)
    if job.status == "pending":
        job.status = "running"
        job.claimed_at = time.time()
    return _serialize(job)


@router.post("/jobs/{job_id}/log")
async def append_log(job_id: str, body: dict) -> dict:
    job = _require(job_id)
    line = body.get("line", "")
    if not isinstance(line, str):
        raise HTTPException(400, detail={"error": {"code": "INVALID_LOG_LINE", "message": "line must be a string"}})
    # Cap log length to avoid unbounded growth.
    if len(job.log) < 2000:
        job.log.append(line)
    return {"ok": True, "line_count": len(job.log)}


@router.post("/jobs/{job_id}/done")
async def mark_done(job_id: str, body: dict) -> dict:
    job = _require(job_id)
    exit_code = body.get("exit_code", 0)
    if not isinstance(exit_code, int):
        raise HTTPException(400, detail={"error": {"code": "INVALID_EXIT_CODE", "message": "exit_code must be an int"}})
    job.exit_code = exit_code
    job.status = "succeeded" if exit_code == 0 else "failed"
    err = body.get("error")
    if isinstance(err, str):
        job.error = err
    job.finished_at = time.time()
    return _serialize(job)


@router.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict:
    return _serialize(_require(job_id))


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str) -> dict:
    job = _require(job_id)
    if job.status in ("pending", "running"):
        job.status = "cancelled"
        job.finished_at = time.time()
    return _serialize(job)


# Health / debug — number of in-flight jobs.
@router.get("/jobs")
async def list_jobs() -> dict:
    _gc()
    return {
        "jobs": [_serialize(j) for j in _jobs.values()],
        "count": len(_jobs),
    }


def _next_pending() -> Optional[Job]:
    for j in _jobs.values():
        if j.status == "pending":
            return j
    return None


def _require(job_id: str) -> Job:
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(404, detail={"error": {"code": "JOB_NOT_FOUND", "message": f"no job with id {job_id}"}})
    return job


def _serialize(job: Job) -> dict:
    return {
        "id": job.id,
        "type": job.type,
        "agent": job.agent,
        "status": job.status,
        "log": job.log,
        "created_at": job.created_at,
        "claimed_at": job.claimed_at,
        "finished_at": job.finished_at,
        "exit_code": job.exit_code,
        "error": job.error,
    }
