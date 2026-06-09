"""Pydantic schemas for the claude.ai connector API.

Strict literal types for every enum-like field so a typo at the call site is
a 422 instead of a silent bad-state row in the database.
"""

from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# ── Pairing flow ──────────────────────────────────────────────────────────────


class PairingStartRequest(BaseModel):
    """Submitted by the extension to begin a pairing handshake.

    `browser_label` is shown in the SkillNote connected-browsers list so the
    user can recognize each pairing (e.g. "Chrome on MacBook Pro"). Optional
    because the extension may not always be able to derive it.
    """

    browser_label: Optional[str] = Field(default=None, max_length=128)


class PairingStartResponse(BaseModel):
    """Returned to the extension after `POST /pair`.

    - `pairing_code` is short and human-friendly (e.g. "7K2J9P") for the user
      to read off the extension and confirm in SkillNote's UI.
    - `pairing_token` is the long opaque token the extension polls with.
      Returned exactly once; never queryable again.
    - `redemption_url` points at the SkillNote page where the user approves.
    """

    integration_id: UUID
    pairing_code: str
    pairing_token: str
    redemption_url: str
    expires_at: datetime


class PairingApproveRequest(BaseModel):
    """User-side approval of a pending pairing.

    The SkillNote frontend POSTs this when the user clicks Approve on the
    pairing-code prompt page.
    """

    pairing_code: str = Field(..., min_length=4, max_length=16)


class PairingStatusResponse(BaseModel):
    """Returned to the extension while polling pairing status.

    When approved=True, `extension_token` is included exactly once. The
    extension stores it and never sees it again from the server.
    """

    approved: bool
    extension_token: Optional[str] = None


# ── Integration management ────────────────────────────────────────────────────


class IntegrationStatusResponse(BaseModel):
    """Status panel data for one paired browser.

    Read by the SkillNote settings page and the extension popup.
    """

    id: UUID
    browser_label: Optional[str]
    status: Literal[
        "pending_approval",
        "active",
        "cookie_expired",
        "disconnected",
        "error",
    ]
    scope: Literal["personal", "organization", "both"]
    claude_ai_org_id: Optional[str]
    last_sync_at: Optional[datetime]
    last_error: Optional[str]
    conflict_policy: Literal["ask", "skillnote_wins", "claude_ai_wins"]
    pending_op_count: int
    failed_op_count: int
    linked_skill_count: int

    model_config = ConfigDict(from_attributes=True)


class IntegrationPatchRequest(BaseModel):
    """Subset of integration fields the user can update in-place."""

    scope: Optional[Literal["personal", "organization", "both"]] = None
    conflict_policy: Optional[
        Literal["ask", "skillnote_wins", "claude_ai_wins"]
    ] = None
    browser_label: Optional[str] = Field(default=None, max_length=128)


# ── Sync operations queue (extension <-> backend) ─────────────────────────────


class SyncOperationOut(BaseModel):
    """One pending operation handed to the extension to execute."""

    id: UUID
    kind: Literal["upload", "update", "delete", "list", "fetch_one", "publish_group"]
    skill_id: Optional[UUID]
    payload: dict[str, Any]
    attempts: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SyncOperationCompleteRequest(BaseModel):
    """Extension reports the outcome of an operation.

    `result` is op-kind-specific:
      - upload/update: { "claude_ai_skill_id": "...", "claude_ai_version": "..." }
      - delete:        { }
      - list:          { "imported_count": N }
      - fetch_one:     { "claude_ai_skill_id": "...", "version": "..." }
    """

    success: bool
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = Field(default=None, max_length=2000)
    claude_ai_org_id: Optional[str] = Field(default=None, max_length=128)
    # When true, the extension is telling us claude.ai rejected the request
    # because the user's session expired (cookies are gone or 401-ed). The
    # backend uses this to flip integration.status -> cookie_expired AND
    # write a `cookie_expired` audit event so the user sees an explanation
    # in the activity feed instead of just a generic op failure.
    auth_expired: bool = False
    # When true, the failure is permanent — retrying won't help (e.g. a
    # claude.ai 400 "skill name already in use", or any 4xx invalid-request).
    # The backend marks the op `failed` immediately instead of burning the
    # 3-attempt retry budget, which is what produced repeated red "upload
    # failed" lines in the activity feed for an unfixable error.
    permanent: bool = False


# ── Reverse sync (claude.ai-authored skill imports) ───────────────────────────


class ImportedSkillRequest(BaseModel):
    """Extension posts a claude.ai-authored skill for SkillNote to ingest.

    The actual ZIP is sent as multipart on the same request — this model
    covers the JSON metadata field. See the API handler for the multipart
    contract.
    """

    claude_ai_skill_id: str = Field(..., max_length=128)
    claude_ai_version: Optional[str] = Field(default=None, max_length=64)
    name: str = Field(..., max_length=64)
    description: str = Field(..., max_length=1024)


class ImportedSkillResponse(BaseModel):
    """Result of an inbound import."""

    skillnote_skill_id: UUID
    created: bool  # True if a new SkillNote skill was created; False if matched existing


class KnownSkillIdsResponse(BaseModel):
    """Extension fetches the set of claude.ai skill IDs SkillNote already
    knows about for this integration. Used to skip re-importing on every
    reverse-sync poll.
    """

    claude_ai_skill_ids: list[str]


class ExtensionSelfStatusResponse(BaseModel):
    """Compact snapshot of this integration the extension can show in its
    popup (skills synced, queue depth) without needing UI-auth routes.
    Authenticated by the extension's bearer token, so it only ever
    reveals this integration's counters."""

    integration_id: UUID
    # Nullable: the DB column is nullable and a browser may pair without a
    # label (allowed by PairingStartRequest). Non-null here caused a 500 on
    # the extension's own status poll for label-less integrations.
    browser_label: Optional[str] = None
    status: Literal[
        "pending_approval", "active", "cookie_expired", "disconnected", "error"
    ]
    linked_skill_count: int
    pending_op_count: int
    failed_op_count: int
    last_sync_at: Optional[datetime] = None
    last_error: Optional[str] = None


# ── Conflict resolution (frontend → backend) ──────────────────────────────────


class ConflictListItem(BaseModel):
    """One conflict row for the SkillNote conflict-resolution UI."""

    link_id: UUID
    integration_id: UUID
    integration_label: Optional[str]
    skillnote_skill_id: Optional[UUID]
    skillnote_skill_slug: Optional[str]
    skillnote_skill_name: Optional[str]
    claude_ai_skill_id: str
    claude_ai_version: Optional[str]
    last_seen_at: Optional[datetime]


class ConflictResolveRequest(BaseModel):
    """User picks a winner; backend enqueues the corresponding sync op."""

    resolution: Literal["keep_skillnote", "keep_claude_ai", "skip"]


# ── Audit log / activity feed ─────────────────────────────────────────────────


class AuditEventOut(BaseModel):
    """One row in the activity feed."""

    id: UUID
    integration_id: Optional[UUID]
    event: str
    skill_id: Optional[UUID]
    # Human-readable skill slug resolved from skill_id, so the activity feed
    # can show "testing-guide" instead of an opaque claude.ai skill ID.
    skill_slug: Optional[str] = None
    detail: dict[str, Any]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TelemetryEvent(BaseModel):
    """Anonymous failure-event payload from the extension.

    Captured at the boundary so the backend never blindly logs arbitrary
    JSON from a bearer-authed client. Length-capped fields prevent the
    extension from filling the logs with a 10MB error blob.
    """

    category: str = Field(..., max_length=64, pattern=r"^[a-zA-Z0-9_]+$")
    ext_version: str = Field(..., max_length=32)
    ts: Optional[datetime] = None
    detail: Optional[dict[str, Any]] = None


class HealthMetricsResponse(BaseModel):
    """Operator-facing health metrics for the connector subsystem.

    Surfaced both at the standard /health endpoint extension and on the
    Settings page's "Connector health" card.
    """

    integrations_active: int
    integrations_with_errors: int
    pending_ops_total: int
    failed_ops_total: int
    diverged_links_total: int
    last_audit_at: Optional[datetime]
    schema_version: str  # alembic head; lets ops detect drift


# ── Sync queue (live what's-in-flight visibility) ────────────────────────────


class SyncQueueItem(BaseModel):
    """One row in the live sync queue view. Joins to skill + integration
    so the UI can render a meaningful row without N+1 fetches."""

    id: UUID
    kind: Literal["upload", "update", "delete", "list", "fetch_one", "publish_group"]
    status: Literal["pending", "in_progress"]
    attempts: int
    last_error: Optional[str]
    created_at: datetime
    started_at: Optional[datetime] = None
    # Joined fields — populated by the API handler.
    integration_id: UUID
    integration_label: Optional[str] = None
    skill_id: Optional[UUID] = None
    skill_slug: Optional[str] = None
    skill_name: Optional[str] = None


class SyncQueueResponse(BaseModel):
    """Snapshot of the active sync queue.

    `items` is sorted by created_at asc (oldest = next-up). `total` is
    the unbounded count so the UI can render "showing 50 of 217" when
    truncated. `oldest_age_seconds` lets the UI flag stale backlogs.
    """

    items: list[SyncQueueItem]
    total: int
    pending_count: int
    in_progress_count: int
    oldest_age_seconds: Optional[float] = None


# ── Analytics (iter 18) ──────────────────────────────────────────────────────


class TopSkillStat(BaseModel):
    skill_id: UUID
    skill_slug: str
    skill_name: str
    sync_count: int


class TopUsedSkillStat(BaseModel):
    """A skill ranked by how often Claude actually INVOKED it on claude.ai
    (distinct from sync_count, which is how often we pushed it)."""

    skill_slug: str
    invocations: int


class IntegrationActivityStat(BaseModel):
    integration_id: UUID
    integration_label: Optional[str]
    syncs_24h: int
    failed_24h: int
    last_sync_at: Optional[datetime]


class SparklinePoint(BaseModel):
    """One bucket of the daily-syncs sparkline."""
    date: str  # YYYY-MM-DD (UTC)
    syncs: int
    failed: int


class DiagnosticCheck(BaseModel):
    """One pass/warn/fail row from the connector diagnostic."""

    id: str  # short stable id, e.g. "backend_reachable" — used as a test key
    label: str  # human-readable
    status: Literal["pass", "warn", "fail"]
    detail: str  # explanatory text + remediation hint when not pass


class TokenRotateResponse(BaseModel):
    """Returned ONCE after a successful token rotation. The new token is
    the only place the cleartext value appears; subsequent reads can
    only get its hash. UI must surface it immediately for the user to
    copy into the extension."""

    integration_id: UUID
    new_extension_token: str
    rotated_at: datetime


class SkillSyncLinkStat(BaseModel):
    """One claude.ai integration's link state for a given local skill."""

    integration_id: UUID
    integration_label: Optional[str]
    integration_status: Literal[
        "pending_approval", "active", "cookie_expired", "disconnected", "error"
    ]
    claude_ai_skill_id: str
    claude_ai_version: Optional[str]
    conflict_state: Literal["none", "diverged", "resolved"]
    last_seen_at: Optional[datetime]
    direction: Literal["outbound", "inbound", "both"]


class SkillSyncStatusResponse(BaseModel):
    """Per-skill sync status surfaced on the skill detail page.

    Tells the user which claude.ai integrations have this skill linked,
    when it was last seen on each, and whether any are in a diverged
    state. The skill itself is identified by slug (URL-friendly).
    """

    skill_id: UUID
    skill_slug: str
    claude_ai_sync_enabled: bool
    links: list[SkillSyncLinkStat]
    pending_op_count: int  # this-skill ops in pending or in_progress


class DiagnosticResponse(BaseModel):
    """Result of a one-click connector health check.

    Bundles N individual checks into a single overall verdict:
      - all pass → overall=pass
      - any fail → overall=fail
      - any warn (no fail) → overall=warn
    """

    overall: Literal["pass", "warn", "fail"]
    checks: list[DiagnosticCheck]
    generated_at: datetime


class ConflictPreviewResponse(BaseModel):
    """Per-conflict detail used by the "Keep SkillNote / Keep claude.ai"
    preview panel.

    We can only render the SkillNote-side content (the claude.ai
    content lives in the extension's browser, not on our server). What
    we CAN show is "what changed on the SkillNote side since the last
    successful push to claude.ai" — that's the exact text that
    'Keep claude.ai' would overwrite.
    """

    link_id: UUID
    integration_id: UUID
    integration_label: Optional[str]
    skill_id: Optional[UUID]
    skill_slug: Optional[str]
    skill_name: Optional[str]
    # The version we last pushed to claude.ai. None when this is an
    # inbound-only link or when the version was deleted.
    last_pushed_version_id: Optional[UUID]
    last_pushed_version_number: Optional[int]
    last_pushed_content_md: Optional[str]
    # The current SkillNote-side latest. If this is the same as
    # last_pushed_*, the conflict is purely remote-side (the user can
    # confidently pick Keep claude.ai).
    current_version_id: Optional[UUID]
    current_version_number: Optional[int]
    current_content_md: Optional[str]
    # Whether the local content actually changed since the last push.
    local_changed: bool
    # claude.ai-side metadata.
    claude_ai_skill_id: str
    claude_ai_version: Optional[str]
    claude_ai_last_seen_at: Optional[datetime]


class AnalyticsResponse(BaseModel):
    """Sync-throughput + per-integration rollup for the analytics panel.

    24h / 7d windows are computed against `now - window`. Counts include
    completed and failed terminal ops only. The sparkline is 7 daily
    UTC-aligned buckets, oldest first.
    """

    skills_synced_24h: int
    skills_synced_7d: int
    failed_24h: int
    failed_7d: int
    sync_success_rate_7d: float  # 0.0–1.0 (1.0 if no ops in window)
    avg_attempts_per_sync_7d: float
    top_skills_7d: list[TopSkillStat]
    per_integration: list[IntegrationActivityStat]
    sparkline_7d: list[SparklinePoint]
    # ── Usage (Claude actually invoked the skill on claude.ai) ──────────
    # Sourced from skill_call_events where agent_name='claude-ai', written
    # by the extension's usage scanner. This is the parity metric with the
    # other connectors (Claude Code / OpenClaw also write skill_call_events).
    invocations_24h: int = 0
    invocations_7d: int = 0
    top_used_skills_7d: list[TopUsedSkillStat] = []
