"""Claude.ai connector API endpoints.

Two audiences hit this module:

  1. The SkillNote frontend (browser, authenticated as the user) — the
     pairing-approval page, the settings list of paired browsers, and the
     conflict resolution UI.

  2. The Chrome extension (no user session, bearer extension_token in the
     Authorization header) — the sync ops queue, the imported-skill push,
     and the skill-bundle fetch.

Both audiences hit `/v1/integrations/claude-ai/...`. Endpoints documented
inline; full design in docs/claude-ai-integration.md.
"""

import io
import logging
import zipfile
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.models.claude_ai import (
    ClaudeAIIntegration,
    ClaudeAISkillLink,
    ClaudeAISyncOperation,
)
from app.db.models.claude_ai_polish import ClaudeAIPairAttempt
from app.db.models import Skill, SkillContentVersion
from app.db.session import get_db
from app.schemas.claude_ai import (
    AuditEventOut,
    ConflictListItem,
    ConflictResolveRequest,
    HealthMetricsResponse,
    ImportedSkillResponse,
    IntegrationPatchRequest,
    IntegrationStatusResponse,
    KnownSkillIdsResponse,
    PairingApproveRequest,
    AnalyticsResponse,
    ConflictPreviewResponse,
    DiagnosticCheck,
    DiagnosticResponse,
    ExtensionSelfStatusResponse,
    IntegrationActivityStat,
    PairingStartRequest,
    PairingStartResponse,
    PairingStatusResponse,
    SparklinePoint,
    SyncOperationCompleteRequest,
    SyncOperationOut,
    SyncQueueItem,
    SyncQueueResponse,
    TelemetryEvent,
    TopSkillStat,
)
from app.services.claude_ai_sync import (
    PairRateLimitExceeded,
    bulk_integration_counters,
    find_integration_by_extension_token,
    find_pending_pairing_by_code,
    find_pending_pairing_by_token,
    generate_pairing_code,
    generate_token,
    hash_token,
    integration_counters,
    pairing_expiry,
    query_audit,
    record_pair_attempt,
    write_audit,
)

router = APIRouter(prefix="/v1/integrations/claude-ai", tags=["claude-ai"])
_log = logging.getLogger("skillnote.claude_ai")

# ── Auth dependency for extension calls ───────────────────────────────────────


def require_extension(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> ClaudeAIIntegration:
    """Resolve `Authorization: Bearer <extension_token>` to an integration.

    Used by every endpoint the Chrome extension calls. The frontend's pairing
    and settings endpoints DON'T use this — they are user-session based
    (currently auth-less, see CLAUDE.md, until ACL lands).
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise api_error(401, "MISSING_BEARER_TOKEN", "Authorization: Bearer <token> required")
    raw = authorization[len("Bearer "):].strip()
    integ = find_integration_by_extension_token(db, raw)
    if integ is None:
        raise api_error(401, "INVALID_EXTENSION_TOKEN", "Token not recognized or revoked")
    if integ.status == "disconnected":
        raise api_error(403, "INTEGRATION_DISCONNECTED", "This integration has been disconnected")
    return integ


# ── Pairing flow ──────────────────────────────────────────────────────────────


def _client_ip(request: Request) -> Optional[str]:
    """Extract the originating IP from X-Forwarded-For (production) or
    request.client (local dev). Production deploys MUST set the trusted
    proxy chain; otherwise an attacker could spoof X-Forwarded-For."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # First IP in the comma list is the original client per RFC 7239.
        return xff.split(",")[0].strip()
    return request.client.host if request.client else None


@router.post("/extension/pair", response_model=PairingStartResponse, status_code=201)
def start_pairing(
    body: PairingStartRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> PairingStartResponse:
    """Step 1 of pairing — extension requests a code.

    Creates a row in `pending_approval` with both a human-readable
    pairing_code (shown in the extension's options page so the user can
    confirm in SkillNote) and an opaque pairing_token (the extension polls
    /pair/status with this).

    Rate-limited per source IP to defeat brute-force pairing-code
    enumeration. Audit-logged so admins can correlate failed pairings
    with suspicious activity.
    """
    source_ip = _client_ip(request)
    try:
        record_pair_attempt(db, source_ip=source_ip, endpoint="pair")
    except PairRateLimitExceeded as e:
        raise api_error(429, "RATE_LIMITED", str(e))

    pairing_code = generate_pairing_code()
    pairing_token = generate_token()

    # In the unlikely case of a code collision among currently-pending rows,
    # retry once before giving up. Six chars over 31 unambiguous glyphs gives
    # 31^6 ≈ 887M codes — a collision needs ~30k concurrent pending pairings
    # to register, so this loop almost always exits on the first iteration.
    for _attempt in range(3):
        existing = db.execute(
            select(ClaudeAIIntegration.id).where(
                ClaudeAIIntegration.pairing_code == pairing_code,
                ClaudeAIIntegration.status == "pending_approval",
            )
        ).first()
        if existing is None:
            break
        pairing_code = generate_pairing_code()
    else:
        raise api_error(503, "PAIRING_CODE_EXHAUSTED", "Could not allocate pairing code; retry")

    integ = ClaudeAIIntegration(
        status="pending_approval",
        scope="both",
        browser_label=body.browser_label,
        pairing_code=pairing_code,
        pairing_token_hash=hash_token(pairing_token),
        pairing_expires_at=pairing_expiry(),
        conflict_policy="ask",
    )
    db.add(integ)
    db.flush()
    write_audit(
        db,
        event="pair_started",
        integration_id=integ.id,
        detail={"browser_label": body.browser_label or ""},
        source_ip=source_ip,
    )
    db.commit()
    db.refresh(integ)

    # Build the redemption URL the extension opens in a new tab. Uses the
    # request's host so it works on both dev and prod without env vars.
    host = request.headers.get("host", "localhost:3000")
    scheme = request.headers.get("x-forwarded-proto", "http")
    # Web URL is typically a different port from the API; trust the
    # SKILLNOTE_WEB_URL env if set, otherwise fall back to swapping port.
    import os
    web_url = os.environ.get("SKILLNOTE_WEB_URL")
    if web_url:
        base = web_url.rstrip("/")
    else:
        # Naive port swap: 8082 (API) -> 3000 (Next). Good enough for the
        # docker-compose dev story; prod always sets SKILLNOTE_WEB_URL.
        host_only = host.split(":")[0]
        base = f"{scheme}://{host_only}:3000"
    redemption_url = f"{base}/settings/integrations/claude-ai/pair?code={pairing_code}"

    return PairingStartResponse(
        integration_id=integ.id,
        pairing_code=pairing_code,
        pairing_token=pairing_token,
        redemption_url=redemption_url,
        expires_at=integ.pairing_expires_at,
    )


@router.post("/pair/approve", status_code=204)
def approve_pairing(
    body: PairingApproveRequest,
    db: Session = Depends(get_db),
) -> Response:
    """Step 2 — user-side approval (SkillNote frontend posts here).

    Sets `pairing_approved_at` on the integration row. Does NOT issue the
    extension token — that happens at the extension's next /pair/status
    poll. Two reasons for the separation:

      1. A shoulder-surfer watching the approval click never sees the
         token; it only travels to the extension that holds the matching
         pairing_token (which is opaque and never displayed).
      2. The token lifecycle stays atomic with the row-state transition,
         eliminating the need to stash raw tokens anywhere.
    """
    integ = find_pending_pairing_by_code(db, body.pairing_code)
    if integ is None:
        raise api_error(404, "PAIRING_NOT_FOUND", "Pairing code not recognized or already used")

    from datetime import datetime, timezone
    if integ.pairing_expires_at and integ.pairing_expires_at < datetime.now(timezone.utc):
        raise api_error(410, "PAIRING_EXPIRED", "Pairing code has expired; restart from the extension")
    if integ.pairing_approved_at is not None:
        # Idempotent — approving twice is harmless, the extension's next
        # poll still redeems the token.
        return Response(status_code=204)

    integ.pairing_approved_at = datetime.now(timezone.utc)
    write_audit(db, event="pair_approved", integration_id=integ.id)
    db.commit()
    return Response(status_code=204)


@router.get("/extension/pair/status", response_model=PairingStatusResponse)
def pairing_status(
    pairing_token: str,
    db: Session = Depends(get_db),
) -> PairingStatusResponse:
    """Step 3 — extension polls until approved.

    Three return shapes:
      - approved=False, no token: user hasn't clicked Approve yet
      - approved=True, with token: this poll redeems the token; happens once
      - 404/410 error: pairing token unknown or already consumed

    On token issuance this atomically:
      1. Generates a fresh extension_token (32 random url-safe bytes)
      2. Stores only its sha256 hash
      3. Clears the pairing handshake fields
      4. Flips status to `active`
    All inside one db.commit() so a crash mid-transaction can't leave a
    partially-paired row.
    """
    # Look up the row WITH a row-level lock so concurrent polls can't both
    # try to issue tokens. Without this, an extension retry storm could
    # generate two tokens for the same pairing — one ends up in the DB,
    # the other gets returned to the second poll but is dead.
    token_hash = hash_token(pairing_token)
    integ = db.execute(
        select(ClaudeAIIntegration)
        .where(ClaudeAIIntegration.pairing_token_hash == token_hash)
        .where(ClaudeAIIntegration.status == "pending_approval")
        .with_for_update()
    ).scalar_one_or_none()

    if integ is None:
        # Not pending — either the extension is polling with a bogus token
        # or the row was already activated and the handshake fields were
        # cleared. Either way, this poll cannot succeed.
        raise api_error(
            404,
            "PAIRING_TOKEN_UNKNOWN",
            "Pairing token expired or already consumed; restart the pairing flow",
        )

    from datetime import datetime, timezone
    if integ.pairing_expires_at and integ.pairing_expires_at < datetime.now(timezone.utc):
        raise api_error(410, "PAIRING_EXPIRED", "Pairing code has expired; restart from the extension")

    if integ.pairing_approved_at is None:
        # User hasn't approved yet. Extension keeps polling.
        return PairingStatusResponse(approved=False, extension_token=None)

    # Approved — atomically issue the token + clear the handshake state.
    # The row is locked above, so a concurrent poll waits for our COMMIT
    # before observing the cleared state and returning 404.
    raw_extension_token = generate_token()
    integ.extension_token_hash = hash_token(raw_extension_token)
    integ.status = "active"
    integ.pairing_code = None
    integ.pairing_token_hash = None
    integ.pairing_approved_at = None
    integ.pairing_expires_at = None

    write_audit(db, event="pair_redeemed", integration_id=integ.id)
    db.commit()
    return PairingStatusResponse(approved=True, extension_token=raw_extension_token)


# ── Integration management (frontend) ─────────────────────────────────────────


@router.get("/integrations", response_model=list[IntegrationStatusResponse])
def list_integrations(db: Session = Depends(get_db)) -> list[IntegrationStatusResponse]:
    """All paired browsers for the current user.

    No user filter today because there's no auth (see CLAUDE.md). When ACL
    lands, filter by user_id from the session.
    """
    rows = (
        db.execute(
            select(ClaudeAIIntegration)
            .where(ClaudeAIIntegration.status != "pending_approval")
            .order_by(ClaudeAIIntegration.created_at.desc())
        )
        .scalars()
        .all()
    )
    # N+1-free counters: one batched call instead of 3*N queries.
    counters_by_id = bulk_integration_counters(db, [r.id for r in rows])
    out: list[IntegrationStatusResponse] = []
    for row in rows:
        out.append(
            IntegrationStatusResponse(
                id=row.id,
                browser_label=row.browser_label,
                status=row.status,  # type: ignore[arg-type]
                scope=row.scope,  # type: ignore[arg-type]
                claude_ai_org_id=row.claude_ai_org_id,
                last_sync_at=row.last_sync_at,
                last_error=row.last_error,
                conflict_policy=row.conflict_policy,  # type: ignore[arg-type]
                **counters_by_id.get(
                    row.id,
                    {"pending_op_count": 0, "failed_op_count": 0, "linked_skill_count": 0},
                ),
            )
        )
    return out


@router.patch("/integrations/{integration_id}", response_model=IntegrationStatusResponse)
def patch_integration(
    integration_id: UUID,
    body: IntegrationPatchRequest,
    db: Session = Depends(get_db),
) -> IntegrationStatusResponse:
    """Update a single integration's scope / conflict policy / label."""
    integ = db.get(ClaudeAIIntegration, integration_id)
    if integ is None:
        raise api_error(404, "INTEGRATION_NOT_FOUND", f"Integration {integration_id} not found")
    changes: dict[str, str] = {}
    if body.scope is not None and body.scope != integ.scope:
        changes["scope"] = f"{integ.scope}→{body.scope}"
        integ.scope = body.scope
    if body.conflict_policy is not None and body.conflict_policy != integ.conflict_policy:
        changes["conflict_policy"] = f"{integ.conflict_policy}→{body.conflict_policy}"
        integ.conflict_policy = body.conflict_policy
    if body.browser_label is not None and body.browser_label != integ.browser_label:
        changes["browser_label"] = "updated"
        integ.browser_label = body.browser_label
    if changes:
        write_audit(
            db,
            event="integration_updated",
            integration_id=integ.id,
            detail=changes,
        )
    db.commit()
    db.refresh(integ)
    counters = integration_counters(db, integ.id)
    return IntegrationStatusResponse(
        id=integ.id,
        browser_label=integ.browser_label,
        status=integ.status,  # type: ignore[arg-type]
        scope=integ.scope,  # type: ignore[arg-type]
        claude_ai_org_id=integ.claude_ai_org_id,
        last_sync_at=integ.last_sync_at,
        last_error=integ.last_error,
        conflict_policy=integ.conflict_policy,  # type: ignore[arg-type]
        **counters,
    )


@router.delete("/integrations/{integration_id}", status_code=204)
def disconnect_integration(
    integration_id: UUID,
    db: Session = Depends(get_db),
) -> Response:
    """Soft-disconnect — flips status, leaves the link/operation history.

    Hard-delete would orphan claude.ai skills (we never delete them on the
    claude.ai side as part of disconnect; the user must do that manually
    if they want). The disconnected state stops the extension from
    receiving new ops; it does NOT revoke skills already pushed.
    """
    integ = db.get(ClaudeAIIntegration, integration_id)
    if integ is None:
        raise api_error(404, "INTEGRATION_NOT_FOUND", f"Integration {integration_id} not found")
    integ.status = "disconnected"
    integ.extension_token_hash = None  # revoke the bearer

    # Mark any pending or in-flight sync ops as failed — they can never
    # complete now that the extension is revoked. Without this, the queue
    # would accumulate orphan rows forever, polluting the failed_ops_total
    # metric and confusing operators.
    db.execute(
        ClaudeAISyncOperation.__table__.update()
        .where(ClaudeAISyncOperation.integration_id == integ.id)
        .where(ClaudeAISyncOperation.status.in_(("pending", "in_progress")))
        .values(
            status="failed",
            last_error="Integration disconnected before completion",
        )
    )

    write_audit(
        db,
        event="integration_disconnected",
        integration_id=integ.id,
        detail={"browser_label": integ.browser_label or ""},
    )
    db.commit()
    return Response(status_code=204)


# ── Sync ops queue (extension) ────────────────────────────────────────────────


@router.get("/extension/operations", response_model=list[SyncOperationOut])
def fetch_operations(
    integ: ClaudeAIIntegration = Depends(require_extension),
    db: Session = Depends(get_db),
    limit: int = 20,
) -> list[SyncOperationOut]:
    """Return the next batch of pending ops for this integration.

    Marks each fetched op `in_progress` atomically so two extension instances
    paired to the same SkillNote don't both try to execute the same op.
    (Edge case — same person on two browsers — but cheap to defend against.)
    """
    limit = max(1, min(limit, 100))
    rows = (
        db.execute(
            select(ClaudeAISyncOperation)
            .where(
                ClaudeAISyncOperation.integration_id == integ.id,
                ClaudeAISyncOperation.status == "pending",
            )
            .order_by(ClaudeAISyncOperation.created_at)
            .with_for_update(skip_locked=True)
            .limit(limit)
        )
        .scalars()
        .all()
    )

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    for row in rows:
        row.status = "in_progress"
        row.started_at = now
        row.attempts += 1
    db.commit()
    return [SyncOperationOut.model_validate(r) for r in rows]


@router.post("/extension/operations/{op_id}/complete", status_code=204)
def complete_operation(
    op_id: UUID,
    body: SyncOperationCompleteRequest,
    integ: ClaudeAIIntegration = Depends(require_extension),
    db: Session = Depends(get_db),
) -> Response:
    """Extension reports the outcome.

    On success for upload/update ops: also upserts the corresponding
    ClaudeAISkillLink row so subsequent syncs of the same skill reuse the
    claude.ai skill ID instead of creating duplicates.

    On failure: writes last_error, sets status=failed if attempts>=3,
    otherwise re-queues as pending so a transient failure auto-retries.
    """
    op = db.get(ClaudeAISyncOperation, op_id)
    if op is None or op.integration_id != integ.id:
        raise api_error(404, "OPERATION_NOT_FOUND", "Operation not found for this integration")
    if op.status not in ("in_progress", "pending"):
        raise api_error(
            409,
            "OPERATION_ALREADY_FINAL",
            f"Operation is already in terminal state '{op.status}'",
        )

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)

    if body.claude_ai_org_id and not integ.claude_ai_org_id:
        # First time we've seen this user's org — cache it on the integration.
        integ.claude_ai_org_id = body.claude_ai_org_id

    if body.success:
        op.status = "completed"
        op.completed_at = now
        op.last_error = None
        integ.last_sync_at = now
        # Upsert link row for upload/update outcomes.
        if op.kind in ("upload", "update") and op.skill_id is not None and body.result:
            ca_skill_id = body.result.get("claude_ai_skill_id")
            ca_version = body.result.get("claude_ai_version")
            if ca_skill_id:
                link = db.execute(
                    select(ClaudeAISkillLink).where(
                        ClaudeAISkillLink.integration_id == integ.id,
                        ClaudeAISkillLink.skillnote_skill_id == op.skill_id,
                    )
                ).scalar_one_or_none()
                if link is None:
                    link = ClaudeAISkillLink(
                        integration_id=integ.id,
                        skillnote_skill_id=op.skill_id,
                        claude_ai_skill_id=ca_skill_id,
                        claude_ai_version=ca_version,
                        last_seen_at=now,
                        direction="outbound",
                    )
                    db.add(link)
                else:
                    link.claude_ai_skill_id = ca_skill_id
                    link.claude_ai_version = ca_version
                    link.last_seen_at = now
                # Use the version_id from the op payload (the version we just
                # pushed); not the skill's current latest, which may have
                # advanced again since the op was enqueued.
                version_id = op.payload.get("version_id") if op.payload else None
                if version_id:
                    try:
                        link.skillnote_version_id = UUID(version_id)
                    except ValueError:
                        # Bad payload — log but don't fail the completion;
                        # the link is still useful with skill_id alone.
                        _log.warning(
                            "claude_ai complete_operation: invalid version_id payload %r on op %s",
                            version_id, op.id,
                        )
        elif op.kind == "delete" and op.skill_id is not None:
            # Drop the link — the claude.ai skill no longer exists.
            db.execute(
                ClaudeAISkillLink.__table__.delete().where(
                    ClaudeAISkillLink.integration_id == integ.id,
                    ClaudeAISkillLink.skillnote_skill_id == op.skill_id,
                )
            )
        # Audit log the successful op outcome. Includes the op kind so the
        # activity feed can render a meaningful row.
        write_audit(
            db,
            event=(
                "skill_pushed" if op.kind in ("upload", "update")
                else "skill_delete_pushed" if op.kind == "delete"
                else "skill_imported" if op.kind == "list"
                else "skill_pushed"
            ),
            integration_id=integ.id,
            skill_id=op.skill_id,
            detail={"op_kind": op.kind, "result": body.result or {}},
        )
    else:
        op.last_error = body.error or "unknown error"
        # Retry budget: 3 attempts total. The fetch path increments attempts
        # at dispatch time, so attempts==3 here means we've used all 3.
        if op.attempts >= 3:
            op.status = "failed"
            op.completed_at = now
            integ.last_error = op.last_error
            write_audit(
                db,
                event="op_failed",
                integration_id=integ.id,
                skill_id=op.skill_id,
                detail={"op_kind": op.kind, "attempts": op.attempts, "error": op.last_error or ""},
            )
        else:
            op.status = "pending"
            op.started_at = None

        # Auth-expired signal flips the integration status BEFORE returning
        # so the UI's next /integrations poll surfaces the "Sign in to
        # claude.ai" CTA. Also emit a dedicated audit event so the activity
        # feed shows a single legible "Browser session expired" row rather
        # than an opaque op_failed cascade.
        if body.auth_expired and integ.status != "cookie_expired":
            integ.status = "cookie_expired"
            write_audit(
                db,
                event="cookie_expired",
                integration_id=integ.id,
                detail={"op_kind": op.kind, "error": (body.error or "")[:200]},
            )

    db.commit()
    return Response(status_code=204)


# ── Skill bundle fetch (extension) ────────────────────────────────────────────


@router.get("/extension/skill-bundle")
def get_skill_bundle(
    skill_id: UUID,
    version_id: UUID,
    integ: ClaudeAIIntegration = Depends(require_extension),
    db: Session = Depends(get_db),
) -> Response:
    """Return the ZIP for a specific skill version.

    Phase 1 implementation builds the ZIP in-memory from the version row's
    content_md + frontmatter. Phase 2 will route through the existing
    LocalBundleStorage to support skills with bundled scripts/assets.
    """
    version = db.get(SkillContentVersion, version_id)
    if version is None or version.skill_id != skill_id:
        raise api_error(404, "VERSION_NOT_FOUND", "Version not found for that skill")

    skill = db.get(Skill, skill_id)
    if skill is None:
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")

    # Compose SKILL.md from frontmatter + content_md. Use yaml.safe_dump
    # so a description containing newlines, quotes, or yaml-special chars
    # (---, : at start) doesn't break the frontmatter parser on the
    # consuming side. Manual string interpolation here was a CVE waiting
    # to happen — a malicious description could inject arbitrary YAML
    # keys that the claude.ai upload handler would then misinterpret.
    import yaml as _yaml
    frontmatter_doc = _yaml.safe_dump(
        {"name": skill.slug, "description": version.description},
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
    )
    skill_md = f"---\n{frontmatter_doc}---\n\n" + (version.content_md or "")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{skill.slug}/SKILL.md", skill_md)
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{skill.slug}-v{version.version}.zip"',
        },
    )


# ── Reverse sync: imported skills + known IDs (extension) ─────────────────────


@router.get("/extension/status", response_model=ExtensionSelfStatusResponse)
def extension_self_status(
    integ: ClaudeAIIntegration = Depends(require_extension),
    db: Session = Depends(get_db),
) -> ExtensionSelfStatusResponse:
    """Compact snapshot for the extension popup.

    Returns *only this integration's* counters. Authenticated by the
    extension's bearer token, so it never leaks across integrations.
    """
    counters = integration_counters(db, integ.id)
    return ExtensionSelfStatusResponse(
        integration_id=integ.id,
        browser_label=integ.browser_label,
        status=integ.status,  # type: ignore[arg-type]
        linked_skill_count=counters["linked_skill_count"],
        pending_op_count=counters["pending_op_count"],
        failed_op_count=counters["failed_op_count"],
        last_sync_at=integ.last_sync_at,
        last_error=integ.last_error,
    )


@router.get("/extension/known-skill-ids", response_model=KnownSkillIdsResponse)
def list_known_skill_ids(
    integ: ClaudeAIIntegration = Depends(require_extension),
    db: Session = Depends(get_db),
) -> KnownSkillIdsResponse:
    """Return all claude.ai skill IDs this integration already has linked.

    The extension uses this to skip re-importing already-synced skills
    during reverse-sync list operations.
    """
    rows = db.execute(
        select(ClaudeAISkillLink.claude_ai_skill_id).where(
            ClaudeAISkillLink.integration_id == integ.id
        )
    ).all()
    return KnownSkillIdsResponse(
        claude_ai_skill_ids=[r[0] for r in rows],
    )


# ── Conflict resolution (frontend) ────────────────────────────────────────────


@router.get("/conflicts", response_model=list[ConflictListItem])
def list_conflicts(db: Session = Depends(get_db)) -> list[ConflictListItem]:
    """All currently-diverged links across every integration.

    Pulled by the SkillNote conflict-resolution UI. Joins skill metadata so
    one query gives the UI everything it needs to render the row.
    """
    rows = db.execute(
        select(
            ClaudeAISkillLink.id,
            ClaudeAISkillLink.integration_id,
            ClaudeAIIntegration.browser_label,
            ClaudeAISkillLink.skillnote_skill_id,
            Skill.slug,
            Skill.name,
            ClaudeAISkillLink.claude_ai_skill_id,
            ClaudeAISkillLink.claude_ai_version,
            ClaudeAISkillLink.last_seen_at,
        )
        .join(
            ClaudeAIIntegration,
            ClaudeAIIntegration.id == ClaudeAISkillLink.integration_id,
        )
        .outerjoin(Skill, Skill.id == ClaudeAISkillLink.skillnote_skill_id)
        .where(ClaudeAISkillLink.conflict_state == "diverged")
        .order_by(ClaudeAISkillLink.last_seen_at.desc().nullslast())
    ).all()
    return [
        ConflictListItem(
            link_id=r.id,
            integration_id=r.integration_id,
            integration_label=r.browser_label,
            skillnote_skill_id=r.skillnote_skill_id,
            skillnote_skill_slug=r.slug,
            skillnote_skill_name=r.name,
            claude_ai_skill_id=r.claude_ai_skill_id,
            claude_ai_version=r.claude_ai_version,
            last_seen_at=r.last_seen_at,
        )
        for r in rows
    ]


@router.get(
    "/conflicts/{link_id}/preview", response_model=ConflictPreviewResponse
)
def preview_conflict(
    link_id: UUID,
    db: Session = Depends(get_db),
) -> ConflictPreviewResponse:
    """Side-by-side preview data for the Keep-SkillNote / Keep-claude.ai
    decision.

    Returns:
      - The last version we pushed to claude.ai (`last_pushed_*`)
      - The current SkillNote-side latest version (`current_*`)
      - A `local_changed` flag — True iff the local content changed since
        the last push, i.e. picking "Keep claude.ai" would overwrite real
        local edits.

    We can't return the claude.ai-side content (it lives in the user's
    browser, not on the server). The UI surfaces version metadata for
    the remote side and trusts the user's domain knowledge there.
    """
    link = db.get(ClaudeAISkillLink, link_id)
    if link is None:
        raise api_error(404, "LINK_NOT_FOUND", f"Link {link_id} not found")

    integ = db.get(ClaudeAIIntegration, link.integration_id)
    integ_label = integ.browser_label if integ else None

    skill: Optional[Skill] = (
        db.get(Skill, link.skillnote_skill_id) if link.skillnote_skill_id else None
    )
    skill_slug = skill.slug if skill else None
    skill_name = skill.name if skill else None

    last_pushed: Optional[SkillContentVersion] = None
    if link.skillnote_version_id is not None:
        last_pushed = db.get(SkillContentVersion, link.skillnote_version_id)

    current: Optional[SkillContentVersion] = None
    if skill is not None:
        current = db.execute(
            select(SkillContentVersion)
            .where(SkillContentVersion.skill_id == skill.id)
            .where(SkillContentVersion.is_latest.is_(True))
        ).scalar_one_or_none()

    local_changed = bool(
        current
        and last_pushed
        and current.id != last_pushed.id
        and (current.content_md or "") != (last_pushed.content_md or "")
    )
    # If we have a `current` but no `last_pushed`, that's also "local
    # changed" — the link was created without ever pushing successfully.
    if current is not None and last_pushed is None:
        local_changed = True

    return ConflictPreviewResponse(
        link_id=link.id,
        integration_id=link.integration_id,
        integration_label=integ_label,
        skill_id=link.skillnote_skill_id,
        skill_slug=skill_slug,
        skill_name=skill_name,
        last_pushed_version_id=last_pushed.id if last_pushed else None,
        last_pushed_version_number=(
            last_pushed.version if last_pushed else None
        ),
        last_pushed_content_md=(last_pushed.content_md if last_pushed else None),
        current_version_id=current.id if current else None,
        current_version_number=(
            current.version if current else None
        ),
        current_content_md=(current.content_md if current else None),
        local_changed=local_changed,
        claude_ai_skill_id=link.claude_ai_skill_id,
        claude_ai_version=link.claude_ai_version,
        claude_ai_last_seen_at=link.last_seen_at,
    )


@router.post("/conflicts/{link_id}/resolve", status_code=204)
def resolve_conflict(
    link_id: UUID,
    body: ConflictResolveRequest,
    db: Session = Depends(get_db),
) -> Response:
    """User picks a winner. Marks the conflict resolved and (for keep_*)
    enqueues a sync op that will overwrite the loser on the next tick.
    """
    link = db.get(ClaudeAISkillLink, link_id)
    if link is None:
        raise api_error(404, "LINK_NOT_FOUND", f"Link {link_id} not found")
    if link.conflict_state != "diverged":
        raise api_error(
            409,
            "LINK_NOT_IN_CONFLICT",
            f"Link is not in conflict (state={link.conflict_state})",
        )

    from app.services.claude_ai_sync import (
        enqueue_skill_upload,
        active_integrations_for_sync,
    )

    if body.resolution == "skip":
        # Nothing to do — just clear the flag. Conflict may re-appear on
        # next divergence event.
        link.conflict_state = "resolved"
    elif body.resolution == "keep_skillnote":
        # Re-upload the SkillNote-side version to claude.ai. The link's
        # outbound op will overwrite the claude.ai-side change.
        if link.skillnote_skill_id is None:
            raise api_error(
                422,
                "NO_SKILLNOTE_SIDE",
                "This conflict has no SkillNote-side skill (inbound-only); keep_skillnote not applicable",
            )
        skill = db.get(Skill, link.skillnote_skill_id)
        if skill is None:
            raise api_error(404, "SKILL_NOT_FOUND", "Linked skill was deleted")
        # Find the integration to scope the enqueue.
        integ = db.get(ClaudeAIIntegration, link.integration_id)
        if integ is None or integ.status == "disconnected":
            raise api_error(
                409,
                "INTEGRATION_INACTIVE",
                "Cannot push — integration is disconnected",
            )
        # Get current latest version_id.
        latest = db.execute(
            select(SkillContentVersion.id)
            .where(SkillContentVersion.skill_id == skill.id)
            .where(SkillContentVersion.is_latest.is_(True))
        ).scalar_one_or_none()
        if latest is None:
            raise api_error(409, "NO_LATEST_VERSION", "Skill has no current version to push")
        enqueue_skill_upload(
            db,
            skill_id=skill.id,
            version_id=latest,
            name=skill.name,
            description=skill.description,
            integrations=[integ],
        )
        link.conflict_state = "resolved"
    elif body.resolution == "keep_claude_ai":
        # Trigger a fetch_one op so the extension pulls the current claude.ai
        # contents and the next inbound import overwrites the SkillNote side.
        from app.db.models.claude_ai import ClaudeAISyncOperation
        op = ClaudeAISyncOperation(
            integration_id=link.integration_id,
            kind="fetch_one",
            skill_id=link.skillnote_skill_id,
            payload={"claude_ai_skill_id": link.claude_ai_skill_id, "overwrite": True},
        )
        db.add(op)
        link.conflict_state = "resolved"

    db.commit()
    return Response(status_code=204)


_VALID_AUDIT_EVENTS = frozenset(
    {
        "pair_started",
        "pair_approved",
        "pair_redeemed",
        "pair_expired",
        "integration_disconnected",
        "integration_updated",
        "skill_pushed",
        "skill_imported",
        "skill_delete_pushed",
        "op_failed",
        "conflict_detected",
        "conflict_resolved",
        "endpoint_changed",
        "token_revoked",
        # Emitted when the extension reports `auth_expired=true` on a
        # complete_operation call; integration.status transitions to
        # cookie_expired and this row explains why in the activity feed.
        "cookie_expired",
    }
)


@router.get("/queue", response_model=SyncQueueResponse)
def list_sync_queue(
    db: Session = Depends(get_db),
    integration_id: Optional[UUID] = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> SyncQueueResponse:
    """Live snapshot of pending + in-progress sync operations.

    Drives the "Sync activity" panel on the settings page. Eager-joins
    skill metadata and integration label in one query to avoid N+1.
    Sorted oldest-first so the user sees the FIFO order.

    Excludes `completed` and `failed` ops — those belong in the activity
    feed, not the queue.
    """
    from sqlalchemy import desc as _desc, func as _func, or_ as _or
    from app.db.models.skill import Skill

    base_q = (
        select(ClaudeAISyncOperation)
        .where(ClaudeAISyncOperation.status.in_(("pending", "in_progress")))
        .order_by(ClaudeAISyncOperation.created_at.asc())
    )
    if integration_id is not None:
        base_q = base_q.where(ClaudeAISyncOperation.integration_id == integration_id)

    # Pull the bounded slice + total counters in two queries (cheap because
    # of the partial index ix_claude_ai_sync_operations_integration_status_created).
    rows: list[ClaudeAISyncOperation] = list(
        db.execute(base_q.limit(limit)).scalars().all()
    )

    total_q = select(_func.count(ClaudeAISyncOperation.id)).where(
        ClaudeAISyncOperation.status.in_(("pending", "in_progress"))
    )
    if integration_id is not None:
        total_q = total_q.where(ClaudeAISyncOperation.integration_id == integration_id)
    total = int(db.execute(total_q).scalar_one())

    by_status_q = (
        select(ClaudeAISyncOperation.status, _func.count(ClaudeAISyncOperation.id))
        .where(ClaudeAISyncOperation.status.in_(("pending", "in_progress")))
        .group_by(ClaudeAISyncOperation.status)
    )
    if integration_id is not None:
        by_status_q = by_status_q.where(
            ClaudeAISyncOperation.integration_id == integration_id
        )
    counts = {s: int(c) for s, c in db.execute(by_status_q).all()}

    oldest_q = select(_func.min(ClaudeAISyncOperation.created_at)).where(
        ClaudeAISyncOperation.status.in_(("pending", "in_progress"))
    )
    if integration_id is not None:
        oldest_q = oldest_q.where(
            ClaudeAISyncOperation.integration_id == integration_id
        )
    oldest_at: Optional[datetime] = db.execute(oldest_q).scalar_one_or_none()

    # Bulk-load skill + integration metadata for the visible rows. One
    # query each — cheaper than per-row eager-load on small page sizes.
    skill_ids = {r.skill_id for r in rows if r.skill_id is not None}
    integ_ids = {r.integration_id for r in rows}
    skills_by_id: dict[UUID, Skill] = {}
    if skill_ids:
        skills_by_id = {
            s.id: s
            for s in db.execute(
                select(Skill).where(Skill.id.in_(skill_ids))
            ).scalars()
        }
    integ_labels: dict[UUID, Optional[str]] = {}
    if integ_ids:
        integ_labels = {
            i.id: i.browser_label
            for i in db.execute(
                select(ClaudeAIIntegration).where(
                    ClaudeAIIntegration.id.in_(integ_ids)
                )
            ).scalars()
        }

    items = [
        SyncQueueItem(
            id=r.id,
            kind=r.kind,  # type: ignore[arg-type]
            status=r.status,  # type: ignore[arg-type]
            attempts=r.attempts,
            last_error=r.last_error,
            created_at=r.created_at,
            started_at=r.started_at,
            integration_id=r.integration_id,
            integration_label=integ_labels.get(r.integration_id),
            skill_id=r.skill_id,
            skill_slug=(skills_by_id.get(r.skill_id).slug if r.skill_id and skills_by_id.get(r.skill_id) else None),
            skill_name=(skills_by_id.get(r.skill_id).name if r.skill_id and skills_by_id.get(r.skill_id) else None),
        )
        for r in rows
    ]

    oldest_age: Optional[float] = None
    if oldest_at is not None:
        from datetime import timezone as _tz
        oldest_age = (datetime.now(_tz.utc) - oldest_at).total_seconds()

    return SyncQueueResponse(
        items=items,
        total=total,
        pending_count=counts.get("pending", 0),
        in_progress_count=counts.get("in_progress", 0),
        oldest_age_seconds=oldest_age,
    )


@router.get("/activity", response_model=list[AuditEventOut])
def list_activity(
    db: Session = Depends(get_db),
    integration_id: Optional[UUID] = None,
    event: Optional[str] = None,
    skill_id: Optional[UUID] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    limit: int = Query(default=50, ge=1, le=500),
    before: Optional[datetime] = None,
) -> list[AuditEventOut]:
    """Audit feed — most recent first.

    Drives the Linear-style activity page in the SkillNote frontend.
    Filterable by integration and event kind for noise reduction.

    ``before`` enables cursor-based pagination: pass the ``created_at`` of
    the last row from the previous page to fetch older events. ``since``
    / ``until`` define an inclusive date window (compliance queries).
    ``skill_id`` scopes to a specific skill's history. ``limit`` is
    bounded [1, 500] so a misbehaving client can't request unbounded
    rows. ``event`` is whitelisted against the canonical set so a typo
    returns a 422 instead of silently zero-matching.
    """
    if event is not None and event not in _VALID_AUDIT_EVENTS:
        raise api_error(
            422,
            "INVALID_EVENT",
            f"Unknown event kind: {event!r}. "
            f"Valid: {sorted(_VALID_AUDIT_EVENTS)}",
        )
    if since is not None and until is not None and since > until:
        raise api_error(
            422,
            "INVALID_DATE_RANGE",
            "`since` must be earlier than `until`",
        )
    rows = query_audit(
        db,
        integration_id=integration_id,
        event=event,
        skill_id=skill_id,
        since=since,
        until=until,
        limit=limit,
        before=before,
    )
    return [AuditEventOut.model_validate(r) for r in rows]


@router.get("/activity/export.csv")
def export_activity_csv(
    db: Session = Depends(get_db),
    integration_id: Optional[UUID] = None,
    event: Optional[str] = None,
    skill_id: Optional[UUID] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    limit: int = Query(default=10_000, ge=1, le=50_000),
) -> Response:
    """CSV download of the audit log — for compliance + offline review.

    Same filter contract as /activity but with a higher row ceiling
    (50k) suitable for an export. Streams the CSV inline so the browser
    triggers a download.
    """
    import csv
    import io as _io
    import json as _json

    if event is not None and event not in _VALID_AUDIT_EVENTS:
        raise api_error(
            422,
            "INVALID_EVENT",
            f"Unknown event kind: {event!r}. "
            f"Valid: {sorted(_VALID_AUDIT_EVENTS)}",
        )
    if since is not None and until is not None and since > until:
        raise api_error(
            422,
            "INVALID_DATE_RANGE",
            "`since` must be earlier than `until`",
        )

    rows = query_audit(
        db,
        integration_id=integration_id,
        event=event,
        skill_id=skill_id,
        since=since,
        until=until,
        limit=limit,
    )

    buf = _io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(["created_at", "event", "integration_id", "skill_id", "detail"])
    for r in rows:
        writer.writerow([
            r.created_at.isoformat(),
            r.event,
            str(r.integration_id) if r.integration_id else "",
            str(r.skill_id) if r.skill_id else "",
            _json.dumps(r.detail, ensure_ascii=False, sort_keys=True),
        ])

    filename = "claude-ai-activity.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Disable caching so a re-export reflects fresh state.
            "Cache-Control": "no-store",
        },
    )


@router.get("/analytics", response_model=AnalyticsResponse)
def connector_analytics(db: Session = Depends(get_db)) -> AnalyticsResponse:
    """Sync-throughput + per-integration rollup for the analytics panel.

    All windows are UTC and computed against now. Only terminal ops
    (completed, failed) are counted toward throughput; pending/in_progress
    are queue depth (already covered by /queue and /health).
    """
    from datetime import timedelta as _td, timezone as _tz
    from sqlalchemy import case, cast, Date, func as _func
    from app.db.models.skill import Skill

    now = datetime.now(_tz.utc)
    cutoff_24h = now - _td(hours=24)
    cutoff_7d = now - _td(days=7)

    op = ClaudeAISyncOperation
    integ = ClaudeAIIntegration

    completed_filter = (op.status == "completed") & (op.completed_at != None)  # noqa: E711
    failed_filter = (op.status == "failed") & (op.completed_at != None)  # noqa: E711

    counts_24h = db.execute(
        select(
            _func.coalesce(
                _func.sum(case((completed_filter, 1), else_=0)), 0
            ),
            _func.coalesce(
                _func.sum(case((failed_filter, 1), else_=0)), 0
            ),
        ).where(op.completed_at >= cutoff_24h)
    ).one()
    syncs_24h, failed_24h = int(counts_24h[0]), int(counts_24h[1])

    counts_7d = db.execute(
        select(
            _func.coalesce(
                _func.sum(case((completed_filter, 1), else_=0)), 0
            ),
            _func.coalesce(
                _func.sum(case((failed_filter, 1), else_=0)), 0
            ),
            _func.coalesce(_func.avg(op.attempts), 0.0),
        ).where(op.completed_at >= cutoff_7d)
    ).one()
    syncs_7d = int(counts_7d[0])
    failed_7d = int(counts_7d[1])
    avg_attempts_7d = float(counts_7d[2])
    total_7d = syncs_7d + failed_7d
    success_rate_7d = 1.0 if total_7d == 0 else syncs_7d / total_7d

    # Top 5 most-synced skills over 7d. Joins Skill so we return
    # human-readable name/slug. Skips ops with NULL skill_id (list ops).
    top_rows = db.execute(
        select(
            Skill.id,
            Skill.slug,
            Skill.name,
            _func.count(op.id).label("sync_count"),
        )
        .join(op, op.skill_id == Skill.id)
        .where(completed_filter)
        .where(op.completed_at >= cutoff_7d)
        .group_by(Skill.id, Skill.slug, Skill.name)
        .order_by(_func.count(op.id).desc())
        .limit(5)
    ).all()
    top_skills = [
        TopSkillStat(
            skill_id=row[0],
            skill_slug=row[1],
            skill_name=row[2],
            sync_count=int(row[3]),
        )
        for row in top_rows
    ]

    # Per-integration 24h activity. LEFT JOIN keeps integrations with zero
    # activity in the result so the UI can show them as "quiet" instead of
    # silently dropping them.
    integ_rows = db.execute(
        select(
            integ.id,
            integ.browser_label,
            integ.last_sync_at,
            _func.coalesce(
                _func.sum(
                    case(
                        (
                            (op.completed_at >= cutoff_24h)
                            & (op.status == "completed"),
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
            _func.coalesce(
                _func.sum(
                    case(
                        (
                            (op.completed_at >= cutoff_24h)
                            & (op.status == "failed"),
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
        )
        .select_from(integ)
        .outerjoin(op, op.integration_id == integ.id)
        .where(integ.status != "disconnected")
        .group_by(integ.id, integ.browser_label, integ.last_sync_at)
        .order_by(integ.last_sync_at.desc().nullslast())
    ).all()
    per_integration = [
        IntegrationActivityStat(
            integration_id=row[0],
            integration_label=row[1],
            last_sync_at=row[2],
            syncs_24h=int(row[3]),
            failed_24h=int(row[4]),
        )
        for row in integ_rows
    ]

    # Sparkline: 7 daily buckets, oldest first, with explicit zeros for
    # days that had no activity. Casting to date in the GROUP BY keeps
    # the row count bounded at 7.
    spark_rows = db.execute(
        select(
            cast(op.completed_at, Date).label("d"),
            _func.coalesce(
                _func.sum(case((completed_filter, 1), else_=0)), 0
            ),
            _func.coalesce(
                _func.sum(case((failed_filter, 1), else_=0)), 0
            ),
        )
        .where(op.completed_at >= cutoff_7d)
        .group_by(cast(op.completed_at, Date))
    ).all()
    spark_by_date = {str(row[0]): (int(row[1]), int(row[2])) for row in spark_rows}
    sparkline: list[SparklinePoint] = []
    for i in range(6, -1, -1):
        day = (now - _td(days=i)).date()
        s, f = spark_by_date.get(str(day), (0, 0))
        sparkline.append(SparklinePoint(date=str(day), syncs=s, failed=f))

    return AnalyticsResponse(
        skills_synced_24h=syncs_24h,
        skills_synced_7d=syncs_7d,
        failed_24h=failed_24h,
        failed_7d=failed_7d,
        sync_success_rate_7d=round(success_rate_7d, 4),
        avg_attempts_per_sync_7d=round(avg_attempts_7d, 2),
        top_skills_7d=top_skills,
        per_integration=per_integration,
        sparkline_7d=sparkline,
    )


@router.get("/diagnostic", response_model=DiagnosticResponse)
def run_diagnostic(db: Session = Depends(get_db)) -> DiagnosticResponse:
    """Run an end-to-end health sweep and return a structured pass/warn/fail.

    Each check is independent and idempotent — calling /diagnostic ten
    times in a row never changes state, only reports it. The UI surfaces
    the verdict as a single "Run diagnostic" button so non-tech users
    have a one-click answer to "is everything OK?"

    Checks (current set, additive over time):
      backend_db          — can we round-trip a SELECT 1
      schema_migrated     — alembic head matches the expected revision
      integrations_paired — at least one active or cookie_expired integration
      no_cookie_expired   — no integrations need re-sign-in
      no_stuck_in_progress — no ops have been in_progress for > 5 minutes
      sync_recent         — at least one integration synced in the last hour
      conflicts_low       — diverged_links_total < 20
      pair_attempts_quiet — fewer than 30 pair attempts in the last hour
    """
    from datetime import timedelta as _td, timezone as _tz
    from sqlalchemy import func as _func, text as _sql_text

    now = datetime.now(_tz.utc)
    checks: list[DiagnosticCheck] = []

    # 1. backend_db
    try:
        db.execute(_sql_text("SELECT 1")).scalar_one()
        checks.append(
            DiagnosticCheck(
                id="backend_db",
                label="Backend database reachable",
                status="pass",
                detail="SkillNote can reach its own database.",
            )
        )
    except Exception as e:  # pragma: no cover - hard to reach in tests
        checks.append(
            DiagnosticCheck(
                id="backend_db",
                label="Backend database reachable",
                status="fail",
                detail=f"DB unreachable: {str(e)[:200]}",
            )
        )

    # 2. schema_migrated — read alembic_version current head.
    EXPECTED_HEAD = "0021_audit_cookie_expired"
    try:
        head = db.execute(
            _sql_text("SELECT version_num FROM alembic_version")
        ).scalar_one_or_none()
        if head == EXPECTED_HEAD:
            checks.append(
                DiagnosticCheck(
                    id="schema_migrated",
                    label="Database schema up to date",
                    status="pass",
                    detail=f"Schema at expected head: {EXPECTED_HEAD}.",
                )
            )
        else:
            checks.append(
                DiagnosticCheck(
                    id="schema_migrated",
                    label="Database schema up to date",
                    status="warn",
                    detail=(
                        f"Schema head is {head!r}, expected "
                        f"{EXPECTED_HEAD!r}. Run `alembic upgrade head`."
                    ),
                )
            )
    except Exception as e:  # pragma: no cover
        checks.append(
            DiagnosticCheck(
                id="schema_migrated",
                label="Database schema up to date",
                status="fail",
                detail=f"Could not read alembic_version: {e}",
            )
        )

    # 3. integrations_paired
    integ_rows = db.execute(
        select(
            ClaudeAIIntegration.status,
            _func.count(ClaudeAIIntegration.id),
        )
        .where(
            ClaudeAIIntegration.status.in_(
                ("active", "cookie_expired", "pending_approval", "error")
            )
        )
        .group_by(ClaudeAIIntegration.status)
    ).all()
    counts_by_status = {s: int(c) for s, c in integ_rows}
    active_or_expired = counts_by_status.get("active", 0) + counts_by_status.get(
        "cookie_expired", 0
    )
    if active_or_expired > 0:
        checks.append(
            DiagnosticCheck(
                id="integrations_paired",
                label="At least one browser is paired",
                status="pass",
                detail=f"{active_or_expired} integration(s) paired.",
            )
        )
    else:
        checks.append(
            DiagnosticCheck(
                id="integrations_paired",
                label="At least one browser is paired",
                status="warn",
                detail=(
                    "No paired browsers yet. Follow the 4-step setup on the "
                    "claude.ai settings page to add one."
                ),
            )
        )

    # 4. no_cookie_expired
    cookie_expired_count = counts_by_status.get("cookie_expired", 0)
    if cookie_expired_count == 0:
        checks.append(
            DiagnosticCheck(
                id="no_cookie_expired",
                label="All paired browsers are signed in",
                status="pass",
                detail="No browsers need re-sign-in to claude.ai.",
            )
        )
    else:
        checks.append(
            DiagnosticCheck(
                id="no_cookie_expired",
                label="All paired browsers are signed in",
                status="fail",
                detail=(
                    f"{cookie_expired_count} browser(s) need re-sign-in to "
                    "claude.ai. Sync will resume after sign-in."
                ),
            )
        )

    # 5. no_stuck_in_progress
    stuck_cutoff = now - _td(minutes=5)
    stuck_count = int(
        db.execute(
            select(_func.count(ClaudeAISyncOperation.id))
            .where(ClaudeAISyncOperation.status == "in_progress")
            .where(ClaudeAISyncOperation.started_at < stuck_cutoff)
        ).scalar_one()
    )
    if stuck_count == 0:
        checks.append(
            DiagnosticCheck(
                id="no_stuck_in_progress",
                label="No stuck sync operations",
                status="pass",
                detail="Every in-flight op has been picked up recently.",
            )
        )
    else:
        checks.append(
            DiagnosticCheck(
                id="no_stuck_in_progress",
                label="No stuck sync operations",
                status="warn",
                detail=(
                    f"{stuck_count} op(s) have been in_progress for > 5 "
                    "minutes. The extension may have died mid-sync. They "
                    "auto-release on the next extension tick."
                ),
            )
        )

    # 6. sync_recent (only meaningful when at least one integration is paired)
    if active_or_expired > 0:
        recent_cutoff = now - _td(hours=1)
        recent_count = int(
            db.execute(
                select(_func.count(ClaudeAIIntegration.id)).where(
                    ClaudeAIIntegration.last_sync_at >= recent_cutoff
                )
            ).scalar_one()
        )
        if recent_count > 0:
            checks.append(
                DiagnosticCheck(
                    id="sync_recent",
                    label="Recent sync activity",
                    status="pass",
                    detail=(
                        f"{recent_count} integration(s) synced in the last hour."
                    ),
                )
            )
        else:
            checks.append(
                DiagnosticCheck(
                    id="sync_recent",
                    label="Recent sync activity",
                    status="warn",
                    detail=(
                        "No syncs in the last hour. The extension runs once a "
                        "minute when claude.ai is open — check that you're "
                        "signed in there."
                    ),
                )
            )

    # 7. conflicts_low
    conflict_count = int(
        db.execute(
            select(_func.count(ClaudeAISkillLink.id)).where(
                ClaudeAISkillLink.conflict_state == "diverged"
            )
        ).scalar_one()
    )
    if conflict_count < 20:
        checks.append(
            DiagnosticCheck(
                id="conflicts_low",
                label="Conflicts manageable",
                status="pass",
                detail=(
                    f"{conflict_count} unresolved conflict(s) — within "
                    "the normal range."
                ),
            )
        )
    else:
        checks.append(
            DiagnosticCheck(
                id="conflicts_low",
                label="Conflicts manageable",
                status="warn",
                detail=(
                    f"{conflict_count} unresolved conflicts. Use the "
                    "Resolve all menu to apply a single policy."
                ),
            )
        )

    # 8. pair_attempts_quiet — burst-detect potential brute force.
    pair_cutoff = now - _td(hours=1)
    pair_attempts_1h = int(
        db.execute(
            select(_func.count(ClaudeAIPairAttempt.id)).where(
                ClaudeAIPairAttempt.created_at >= pair_cutoff
            )
        ).scalar_one()
    )
    if pair_attempts_1h < 30:
        checks.append(
            DiagnosticCheck(
                id="pair_attempts_quiet",
                label="No suspicious pair traffic",
                status="pass",
                detail=f"{pair_attempts_1h} pair attempt(s) in the last hour.",
            )
        )
    else:
        checks.append(
            DiagnosticCheck(
                id="pair_attempts_quiet",
                label="No suspicious pair traffic",
                status="warn",
                detail=(
                    f"{pair_attempts_1h} pair attempts in the last hour. "
                    "Check your access logs if you didn't expect this."
                ),
            )
        )

    # Overall verdict — fail dominates warn dominates pass.
    statuses = {c.status for c in checks}
    overall: str
    if "fail" in statuses:
        overall = "fail"
    elif "warn" in statuses:
        overall = "warn"
    else:
        overall = "pass"

    return DiagnosticResponse(
        overall=overall,  # type: ignore[arg-type]
        checks=checks,
        generated_at=now,
    )


@router.get("/health", response_model=HealthMetricsResponse)
def connector_health(db: Session = Depends(get_db)) -> HealthMetricsResponse:
    """Connector subsystem health metrics.

    Backs both the SkillNote settings page's "Connector health" card and
    any external monitoring hooked into this endpoint.
    """
    from sqlalchemy import func as _func, text as _text

    active = db.execute(
        select(_func.count())
        .select_from(ClaudeAIIntegration)
        .where(ClaudeAIIntegration.status == "active")
    ).scalar_one()
    errors = db.execute(
        select(_func.count())
        .select_from(ClaudeAIIntegration)
        .where(ClaudeAIIntegration.status == "error")
    ).scalar_one()
    pending = db.execute(
        select(_func.count())
        .select_from(ClaudeAISyncOperation)
        .where(ClaudeAISyncOperation.status.in_(("pending", "in_progress")))
    ).scalar_one()
    failed = db.execute(
        select(_func.count())
        .select_from(ClaudeAISyncOperation)
        .where(ClaudeAISyncOperation.status == "failed")
    ).scalar_one()
    diverged = db.execute(
        select(_func.count())
        .select_from(ClaudeAISkillLink)
        .where(ClaudeAISkillLink.conflict_state == "diverged")
    ).scalar_one()
    last_audit = db.execute(
        select(_func.max(_text("created_at"))).select_from(
            _text("claude_ai_audit_log")
        )
    ).scalar()
    head = db.execute(_text("SELECT version_num FROM alembic_version")).scalar()

    return HealthMetricsResponse(
        integrations_active=int(active),
        integrations_with_errors=int(errors),
        pending_ops_total=int(pending),
        failed_ops_total=int(failed),
        diverged_links_total=int(diverged),
        last_audit_at=last_audit,
        schema_version=str(head) if head else "unknown",
    )


# ── Per-skill sync toggle (frontend) ──────────────────────────────────────────


from pydantic import BaseModel as _BaseModel  # local import — small surface


class _SkillSyncToggleRequest(_BaseModel):
    enabled: bool


@router.patch("/skills/{skill_id}/sync", status_code=204)
def toggle_skill_sync(
    skill_id: UUID,
    body: _SkillSyncToggleRequest,
    db: Session = Depends(get_db),
) -> Response:
    """Flip the per-skill claude.ai sync toggle.

    Used by the skill detail page to exclude specific skills (e.g. local
    dev experiments, sensitive content) from the connector. Disabling a
    skill that's already synced does NOT delete it from claude.ai — that
    requires an explicit delete. Future uploads simply stop firing.
    """
    skill = db.get(Skill, skill_id)
    if skill is None:
        raise api_error(404, "SKILL_NOT_FOUND", f"Skill {skill_id} not found")
    skill.claude_ai_sync_enabled = body.enabled
    db.commit()
    return Response(status_code=204)


@router.post("/extension/telemetry", status_code=204)
def post_telemetry(
    body: TelemetryEvent,
    integ: ClaudeAIIntegration = Depends(require_extension),
) -> Response:
    """Anonymous failure telemetry from the extension.

    Logged server-side; not persisted to the DB because most operators
    don't want the extra storage churn. If you want to keep history,
    add a `claude_ai_telemetry_events` table in a later migration.

    Inputs are length-capped and pattern-validated via the TelemetryEvent
    schema so a malicious bearer can't dump a 10MB blob into the log
    pipeline.
    """
    _log.info(
        "claude-ai extension telemetry: integration=%s category=%s ext_version=%s detail=%s",
        integ.id,
        body.category,
        body.ext_version,
        body.detail,
    )
    return Response(status_code=204)


@router.post(
    "/extension/imported-skill",
    response_model=ImportedSkillResponse,
    status_code=201,
)
def import_skill_from_claude_ai(
    claude_ai_skill_id: str = Form(..., max_length=128),
    name: str = Form(..., max_length=64),
    description: str = Form(..., max_length=1024),
    claude_ai_version: Optional[str] = Form(default=None, max_length=64),
    bundle: UploadFile = File(...),
    integ: ClaudeAIIntegration = Depends(require_extension),
    db: Session = Depends(get_db),
) -> ImportedSkillResponse:
    """Inbound: extension pushes a claude.ai-authored skill.

    Full bundle ingestion: parses SKILL.md, creates or updates the
    SkillNote skill, adds a fresh SkillContentVersion, and upserts the
    integration link. Conflict-aware: if both sides changed since the
    last sync, the link is marked diverged and surfaced in the UI.
    """
    # 1. Validate the ZIP shape + extract metadata via the existing
    # bundle_validator. This runs the same security checks (symlinks,
    # path traversal, size caps, frontmatter validity) that the manual
    # upload path uses, so claude.ai-authored skills can't smuggle
    # anything past the validators that local uploads can't.
    import tempfile
    from app.validators.bundle_validator import (
        FRONTMATTER_RE,
        slugify,
        validate_zip_and_extract_metadata,
    )

    raw = bundle.file.read()
    if not raw:
        raise api_error(422, "EMPTY_BUNDLE", "Bundle upload is empty")

    try:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        try:
            parsed_name, parsed_slug, parsed_description = (
                validate_zip_and_extract_metadata(tmp_path)
            )
        except ValueError as e:
            raise api_error(422, "INVALID_BUNDLE", str(e))
        finally:
            import os as _os
            try:
                _os.unlink(tmp_path)
            except OSError:
                pass
    except zipfile.BadZipFile:
        raise api_error(422, "INVALID_ZIP", "Uploaded file is not a valid ZIP archive")

    # If the form metadata disagrees with the bundle's SKILL.md, the
    # bundle wins (it's the source of truth). Log a warning so admins
    # can investigate extension bugs that drift the two.
    if parsed_name != name:
        _log.warning(
            "claude-ai import: form name %r != bundle name %r; using bundle",
            name, parsed_name,
        )

    # 2. Extract content_md (the body of SKILL.md after frontmatter) so
    # the SkillContentVersion captures the actual skill instructions.
    content_md = ""
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            skill_path = next(
                (n for n in zf.namelist() if n.endswith("SKILL.md")), None
            )
            if skill_path:
                raw_content = zf.read(skill_path).decode("utf-8", errors="ignore")
                m = FRONTMATTER_RE.match(raw_content)
                content_md = raw_content[m.end():] if m else raw_content
    except Exception:  # noqa: BLE001
        # Content extraction is best-effort; the validator already
        # confirmed SKILL.md exists.
        pass

    # 3. Upsert the SkillNote skill. Match on slug first (canonical
    # identifier) — if found, link to it; otherwise create.
    from datetime import datetime, timezone
    import uuid as _uuid
    from app.db.models import Skill, SkillContentVersion

    now = datetime.now(timezone.utc)
    skill = db.execute(
        select(Skill).where(Skill.slug == parsed_slug)
    ).scalar_one_or_none()
    created_new_skill = False

    if skill is None:
        skill = Skill(
            id=_uuid.uuid4(),
            name=parsed_name,
            slug=parsed_slug,
            description=parsed_description,
            content_md=content_md,
            collections=[],
            current_version=0,
            # Imported from claude.ai — flag so the frontend can show provenance.
            claude_ai_sync_enabled=True,
        )
        db.add(skill)
        db.flush()
        created_new_skill = True

    # Capture the local "latest version BEFORE this import" so we can
    # distinguish "local was changed by user between syncs" from "local
    # change was caused by this import itself." Used by the conflict
    # detector below.
    pre_import_latest_id = db.execute(
        select(SkillContentVersion.id)
        .where(SkillContentVersion.skill_id == skill.id)
        .where(SkillContentVersion.is_latest.is_(True))
    ).scalar_one_or_none()

    if not created_new_skill:
        # Refresh in-place. Bumps current_version via _create_content_version below.
        skill.name = parsed_name
        skill.description = parsed_description
        skill.content_md = content_md

    # 4. Create a SkillContentVersion snapshot. Cannot call
    # skills.py's _create_content_version helper directly because it
    # would re-trigger enqueue_skill_upload — instead we mark the
    # incoming content as the new latest manually and avoid the
    # outbound-op echo (the data already lives on claude.ai).
    next_ver = (skill.current_version or 0) + 1
    db.execute(
        SkillContentVersion.__table__.update()
        .where(SkillContentVersion.skill_id == skill.id)
        .where(SkillContentVersion.is_latest.is_(True))
        .values(is_latest=False)
    )
    new_version = SkillContentVersion(
        id=_uuid.uuid4(),
        skill_id=skill.id,
        version=next_ver,
        title=skill.name,
        description=skill.description,
        content_md=skill.content_md or "",
        collections=skill.collections or [],
        is_latest=True,
    )
    db.add(new_version)
    skill.current_version = next_ver
    # Flush so the link's FK to skill_content_versions.id resolves.
    db.flush()

    # 5. Upsert the link + run conflict detection.
    from app.services.claude_ai_sync import detect_link_divergence

    existing_link = db.execute(
        select(ClaudeAISkillLink).where(
            ClaudeAISkillLink.integration_id == integ.id,
            ClaudeAISkillLink.claude_ai_skill_id == claude_ai_skill_id,
        )
    ).scalar_one_or_none()

    if existing_link is None:
        link = ClaudeAISkillLink(
            integration_id=integ.id,
            skillnote_skill_id=skill.id,
            skillnote_version_id=new_version.id,
            claude_ai_skill_id=claude_ai_skill_id,
            claude_ai_version=claude_ai_version,
            last_seen_at=now,
            direction="inbound",
        )
        db.add(link)
    else:
        # Conflict check BEFORE we update the link's recorded version.
        # Use the PRE-IMPORT local latest (captured above) — not the
        # version we're about to create — so we don't false-positive on
        # the import itself being a local change.
        detect_link_divergence(
            db,
            link=existing_link,
            incoming_claude_ai_version=claude_ai_version,
            skillnote_version_id=pre_import_latest_id,
        )
        existing_link.skillnote_skill_id = skill.id
        existing_link.skillnote_version_id = new_version.id
        existing_link.claude_ai_version = claude_ai_version
        existing_link.last_seen_at = now
        existing_link.direction = "both"

    from app.services.claude_ai_sync import write_audit
    write_audit(
        db,
        event="skill_imported",
        integration_id=integ.id,
        skill_id=skill.id,
        detail={"claude_ai_skill_id": claude_ai_skill_id, "new_skill": created_new_skill},
    )
    db.commit()
    return ImportedSkillResponse(skillnote_skill_id=skill.id, created=created_new_skill)


# ── Maintenance endpoint (admin-triggered + periodic) ─────────────────────────


@router.post("/admin/cleanup-expired-pairings", status_code=200)
def cleanup_expired_pairings(db: Session = Depends(get_db)) -> dict:
    """Periodic cleanup of pending_approval rows past their expiry.

    Safe to call from a cron job (e.g. every 5 minutes). Returns the
    number of rows expired so monitoring can graph the rate.
    """
    from app.services.claude_ai_sync import expire_stale_pairings
    expired = expire_stale_pairings(db)
    db.commit()
    return {"expired": expired}
