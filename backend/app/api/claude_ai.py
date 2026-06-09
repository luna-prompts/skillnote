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
    SkillSyncLinkStat,
    SkillSyncStatusResponse,
    TokenRotateResponse,
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
    TopUsedSkillStat,
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

    # ── Auto-approve (testing / trusted single-user self-host) ──────────────
    # When SKILLNOTE_CLAUDE_AI_AUTO_APPROVE=1, skip the manual "confirm the
    # 6-char code in SkillNote" step: mark the pairing approved immediately
    # so the extension's first /pair/status poll redeems the token. The user
    # just pastes the URL and hits Connect — no approval click.
    #
    # SECURITY: this removes the human-in-the-loop check that prevents a
    # malicious page from silently pairing a browser. Only enable on a
    # trusted, single-user, LAN/localhost instance. Default OFF so production
    # always keeps the approval step.
    import os as _os
    if _os.environ.get("SKILLNOTE_CLAUDE_AI_AUTO_APPROVE") == "1":
        from datetime import timezone as _tz
        integ.pairing_approved_at = datetime.now(_tz.utc)
        write_audit(
            db,
            event="pair_approved",
            integration_id=integ.id,
            detail={"auto": True},
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


@router.get("/pairings/pending")
def list_pending_pairings(db: Session = Depends(get_db)):
    """Pending browser-pairing requests awaiting user approval.

    Powers the notifications bell so the user can approve a pairing from
    anywhere in the app (the code is returned for them to verify against their
    extension), instead of a full-page approval interstitial. Excludes expired
    and already-approved requests.
    """
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    rows = db.execute(
        select(ClaudeAIIntegration)
        .where(ClaudeAIIntegration.status == "pending_approval")
        .where(ClaudeAIIntegration.pairing_approved_at.is_(None))
        .order_by(ClaudeAIIntegration.created_at.desc())
    ).scalars().all()
    out = []
    for r in rows:
        if r.pairing_expires_at and r.pairing_expires_at < now:
            continue  # expired — don't surface stale requests
        out.append(
            {
                "integration_id": str(r.id),
                "browser_label": r.browser_label,
                "pairing_code": r.pairing_code,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "expires_at": r.pairing_expires_at.isoformat()
                if r.pairing_expires_at
                else None,
            }
        )
    return out


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

    # Backfill: enqueue upload ops for every existing sync-enabled skill so
    # a freshly-paired browser actually receives the current catalog. Without
    # this, skills created before the integration existed never get ops and
    # the browser shows "0 skills synced" forever.
    from app.services.claude_ai_sync import backfill_uploads_for_integration
    n = backfill_uploads_for_integration(db, integ)
    if n:
        write_audit(
            db,
            event="sync_triggered",
            integration_id=integ.id,
            detail={"reason": "pair_backfill", "enqueued": n},
        )

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


@router.post("/integrations/{integration_id}/trigger-sync", status_code=204)
def trigger_sync(
    integration_id: UUID,
    db: Session = Depends(get_db),
) -> Response:
    """Nudge the extension to do something on its next tick.

    Enqueues a `list` op against the integration. The extension picks
    it up on its next minute-aligned alarm and performs a reverse-sync
    scan, which pulls any claude.ai-side updates and pushes any local
    pending changes the queue had backed up.

    Useful from the UI as a "Sync now" button — the user clicks it,
    the next extension tick fires, and the queue counters update.
    Idempotent: if a list op is already pending, this is a no-op.
    """
    from datetime import timezone as _tz
    integ = db.get(ClaudeAIIntegration, integration_id)
    if integ is None:
        raise api_error(404, "INTEGRATION_NOT_FOUND", f"Integration {integration_id} not found")
    if integ.status not in ("active", "cookie_expired"):
        raise api_error(
            409,
            "INTEGRATION_NOT_ACTIVE",
            f"Cannot trigger sync on integration in '{integ.status}' state",
        )

    # Coalesce the reverse-sync (pull) op: if there's already a pending
    # list op, don't pile on.
    existing = db.execute(
        select(ClaudeAISyncOperation.id)
        .where(ClaudeAISyncOperation.integration_id == integ.id)
        .where(ClaudeAISyncOperation.kind == "list")
        .where(ClaudeAISyncOperation.status.in_(("pending", "in_progress")))
        .limit(1)
    ).scalar_one_or_none()
    if existing is None:
        db.add(
            ClaudeAISyncOperation(
                integration_id=integ.id,
                kind="list",
                skill_id=None,
                payload={"reason": "user_triggered"},
            )
        )

    # Also PUSH: backfill upload ops for any sync-enabled skill not yet
    # synced to this browser. "Sync now" should make local skills appear
    # on claude.ai, not just pull remote ones.
    from app.services.claude_ai_sync import (
        backfill_uploads_for_integration,
        write_audit,
    )
    pushed = backfill_uploads_for_integration(db, integ)

    write_audit(
        db,
        event="sync_triggered",
        integration_id=integ.id,
        detail={"reason": "user_triggered", "uploads_enqueued": pushed},
    )
    db.commit()
    return Response(status_code=204)


@router.post(
    "/integrations/{integration_id}/rotate-token",
    response_model=TokenRotateResponse,
)
def rotate_extension_token(
    integration_id: UUID,
    db: Session = Depends(get_db),
) -> TokenRotateResponse:
    # Per-integration rate limit. Without auth on the SkillNote UI an
    # attacker who briefly accesses the page could rotate tokens
    # repeatedly to lock the real user out. 5 rotations / hour is
    # plenty for any legitimate "I think it leaked again" recovery
    # while preventing DoS. The bypass env flag mirrors the pair
    # rate-limit pattern so the test suite can still exercise the
    # endpoint hundreds of times against a single integration.
    import os as _rl_os
    if _rl_os.environ.get("SKILLNOTE_DISABLE_PAIR_RATE_LIMIT") != "1":
        from datetime import timedelta as _rl_td, timezone as _rl_tz
        from sqlalchemy import func as _rl_func
        from app.db.models.claude_ai_polish import ClaudeAIAuditLog
        cutoff = datetime.now(_rl_tz.utc) - _rl_td(hours=1)
        recent = int(
            db.execute(
                select(_rl_func.count(ClaudeAIAuditLog.id))
                .where(ClaudeAIAuditLog.integration_id == integration_id)
                .where(ClaudeAIAuditLog.event == "token_revoked")
                .where(ClaudeAIAuditLog.created_at >= cutoff)
            ).scalar_one()
        )
        if recent >= 5:
            raise api_error(
                429,
                "RATE_LIMITED",
                "Too many token rotations on this integration — wait an hour.",
            )
    """Mint a new extension_token without un-pairing.

    Use case: the user thinks the existing token has leaked (shared
    screenshot, accidentally copied into a paste site, lost laptop).
    Rotating issues a new token, hashes it onto the integration row,
    invalidates the old one — the user must paste the new token into
    the extension's options page.

    The cleartext token is returned ONCE in the response. We can't
    show it again later; the row only stores the hash.
    """
    from datetime import timezone as _tz
    from app.services.claude_ai_sync import (
        generate_token,
        hash_token,
        write_audit,
    )

    integ = db.get(ClaudeAIIntegration, integration_id)
    if integ is None:
        raise api_error(404, "INTEGRATION_NOT_FOUND", f"Integration {integration_id} not found")
    if integ.status == "disconnected":
        raise api_error(
            409,
            "INTEGRATION_DISCONNECTED",
            "Disconnected integrations can't have their tokens rotated — re-pair instead.",
        )

    new_token = generate_token()
    integ.extension_token_hash = hash_token(new_token)
    now = datetime.now(_tz.utc)
    # We also clear last_error since the operator presumably just
    # accepted a rotated token; nothing else "broken" should be sticky.
    integ.last_error = None

    write_audit(
        db,
        event="token_revoked",
        integration_id=integ.id,
        detail={
            "action": "rotate",
            "browser_label": integ.browser_label or "",
        },
    )
    db.commit()
    return TokenRotateResponse(
        integration_id=integ.id,
        new_extension_token=new_token,
        rotated_at=now,
    )


@router.post("/operations/{op_id}/retry", status_code=204)
def retry_failed_operation(
    op_id: UUID,
    db: Session = Depends(get_db),
) -> Response:
    """Re-queue a failed sync operation.

    Resets status to pending, clears attempts + last_error, lets the
    extension pick it up on its next tick. Only valid for ops in the
    'failed' terminal state — re-queueing pending/in_progress would
    let the user fork the queue, and re-queueing completed ops would
    fire duplicate side effects.

    Emits an audit row so operators can see who retried what.
    """
    op = db.get(ClaudeAISyncOperation, op_id)
    if op is None:
        raise api_error(404, "OPERATION_NOT_FOUND", f"Operation {op_id} not found")
    if op.status != "failed":
        raise api_error(
            409,
            "OPERATION_NOT_RETRYABLE",
            f"Operation is in '{op.status}' state — only 'failed' ops can be retried",
        )
    op.status = "pending"
    op.attempts = 0
    op.last_error = None
    op.started_at = None
    op.completed_at = None

    from app.services.claude_ai_sync import write_audit
    write_audit(
        db,
        event="op_retried",
        integration_id=op.integration_id,
        skill_id=op.skill_id,
        detail={"op_id": str(op.id), "op_kind": op.kind},
    )
    db.commit()
    return Response(status_code=204)


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
        # Idempotency: the extension may re-report a completion if its first
        # /complete response was lost (network blip, or the MV3 service worker
        # was killed right after the claude.ai upload). Re-reporting success on
        # an already-completed op is a no-op, NOT an error — otherwise the
        # extension treats a genuinely-successful op as failed and re-drives it.
        if op.status == "completed" and body.success:
            return Response(status_code=204)
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
        elif op.kind == "delete":
            # Drop the link — the claude.ai skill no longer exists. Delete ops
            # carry skill_id=None on purpose (the local skill is usually gone,
            # and the skills→ops FK is ondelete=CASCADE), so the link key lives
            # in the payload. Match on the claude.ai skill id (the stable link
            # identifier); fall back to the recorded skillnote_skill_id.
            ca_id = (op.payload or {}).get("claude_ai_skill_id")
            sn_id = (op.payload or {}).get("skillnote_skill_id")
            cond = None
            if ca_id:
                cond = ClaudeAISkillLink.claude_ai_skill_id == ca_id
            elif sn_id:
                try:
                    cond = ClaudeAISkillLink.skillnote_skill_id == UUID(str(sn_id))
                except (ValueError, TypeError):
                    cond = None
            if cond is not None:
                db.execute(
                    ClaudeAISkillLink.__table__.delete().where(
                        ClaudeAISkillLink.integration_id == integ.id,
                        cond,
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
        # `permanent` short-circuits the budget — a 400 "name already in use"
        # can never succeed by retrying, so we fail it on the first report
        # instead of logging three identical red lines.
        if body.permanent or op.attempts >= 3:
            op.status = "failed"
            op.completed_at = now
            integ.last_error = op.last_error
            write_audit(
                db,
                event="op_failed",
                integration_id=integ.id,
                skill_id=op.skill_id,
                detail={
                    "op_kind": op.kind,
                    "attempts": op.attempts,
                    "error": op.last_error or "",
                    "permanent": bool(body.permanent),
                },
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

    # Authorization scoping: a bearer token must not be able to download any
    # skill on the instance. The fetch is legitimate only when THIS integration
    # is already linked to the skill, or has a queued upload/update op for it
    # (the normal "fetch bundle to push it" flow). Also honor the per-skill
    # opt-out — a sync-disabled skill is never served.
    if not getattr(skill, "claude_ai_sync_enabled", True):
        raise api_error(404, "SKILL_NOT_FOUND", "Skill not found")
    authorized = db.execute(
        select(ClaudeAISkillLink.id).where(
            ClaudeAISkillLink.integration_id == integ.id,
            ClaudeAISkillLink.skillnote_skill_id == skill_id,
        ).limit(1)
    ).first() is not None
    if not authorized:
        authorized = db.execute(
            select(ClaudeAISyncOperation.id).where(
                ClaudeAISyncOperation.integration_id == integ.id,
                ClaudeAISyncOperation.skill_id == skill_id,
                ClaudeAISyncOperation.kind.in_(("upload", "update")),
                ClaudeAISyncOperation.status.in_(("pending", "in_progress")),
            ).limit(1)
        ).first() is not None
    if not authorized:
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


@router.get("/extension/plugin-groups")
def list_plugin_groups(
    integ: ClaudeAIIntegration = Depends(require_extension),
    db: Session = Depends(get_db),
) -> dict:
    """List the claude.ai plugin groups to publish — one per collection the
    user toggled ``published_to_claude_ai`` (with at least one skill).

    The extension uses this to know which groups to (re)upload and, by diffing
    against what's already in the SkillNote marketplace, which to uninstall.
    Each entry: ``name`` (plugin slug), ``display_name`` ("SkillNote: X"),
    ``skill_count``. Connector-page status reads the count from here too.
    """
    from app.services.claude_ai_marketplace import (
        PluginAuthor,
        collect_published_collection_plugins,
    )

    plugins = collect_published_collection_plugins(db, author=PluginAuthor(name="SkillNote"))
    return {
        "marketplace_name": "SkillNote",
        "groups": [
            {
                "name": cp.manifest.name,
                "display_name": cp.manifest.display_name,
                "skill_count": len(cp.skills),
            }
            for cp in plugins
        ],
    }


@router.get("/extension/plugin-bundle")
def get_plugin_bundle(
    group: str,
    integ: ClaudeAIIntegration = Depends(require_extension),
    db: Session = Depends(get_db),
) -> Response:
    """Return the plugin ZIP for ONE published collection group.

    ``group`` is the plugin slug from ``/extension/plugin-groups`` (the
    kebab-slug of the collection name). The extension uploads this via
    claude.ai's ``account-upload`` to create/refresh the "SkillNote: <name>"
    group. The group is replace-as-a-whole, so the ZIP always reflects the
    collection's complete current skill set. An ETag over the bytes lets the
    extension skip a no-op re-upload (the generator is deterministic).
    """
    import hashlib

    from app.services.claude_ai_marketplace import (
        PluginAuthor,
        build_plugin_zip,
        collect_published_collection_plugins,
    )

    plugins = collect_published_collection_plugins(db, author=PluginAuthor(name="SkillNote"))
    match = next((cp for cp in plugins if cp.manifest.name == group), None)
    if match is None:
        raise api_error(404, "GROUP_NOT_FOUND", "No published collection group by that name")

    data = build_plugin_zip(match.skills, match.manifest)
    etag = '"' + hashlib.sha256(data).hexdigest()[:32] + '"'
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{group}-plugin.zip"',
            "ETag": etag,
            "X-Skill-Count": str(len(match.skills)),
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
        write_audit,
    )

    # The inbound version staged on a diverged_ask outcome — located by the
    # explicit marker on the link, NOT a "newest non-latest" heuristic. An
    # intervening save/restore/re-import creates newer non-latest rows, so the
    # old heuristic would promote/delete the WRONG version (silent loss). H1.
    staged_inbound: Optional[SkillContentVersion] = None
    if link.staged_version_id is not None:
        staged_inbound = db.get(SkillContentVersion, link.staged_version_id)

    audit_detail: dict = {
        "link_id": str(link.id),
        "resolution": body.resolution,
        "claude_ai_skill_id": link.claude_ai_skill_id,
    }

    if body.resolution == "skip":
        # User wants to defer. Clear the flag but DON'T touch content on
        # either side. The next divergence event can re-flag.
        link.staged_version_id = None
        link.conflict_state = "resolved"

    elif body.resolution == "keep_skillnote":
        if link.skillnote_skill_id is None:
            raise api_error(
                422,
                "NO_SKILLNOTE_SIDE",
                "This conflict has no SkillNote-side skill (inbound-only); keep_skillnote not applicable",
            )
        skill = db.get(Skill, link.skillnote_skill_id)
        if skill is None:
            raise api_error(404, "SKILL_NOT_FOUND", "Linked skill was deleted")
        integ = db.get(ClaudeAIIntegration, link.integration_id)
        if integ is None or integ.status == "disconnected":
            raise api_error(
                409,
                "INTEGRATION_INACTIVE",
                "Cannot push — integration is disconnected",
            )
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
        # Discard the staged inbound version — it was the rejected branch.
        # Hard-delete keeps the version history clean; the audit row
        # below preserves the fact that it existed for compliance.
        if staged_inbound is not None:
            audit_detail["discarded_staged_version_id"] = str(staged_inbound.id)
            db.delete(staged_inbound)
        link.staged_version_id = None
        # A2: re-anchor the baseline to the version we just pushed so the
        # rejected remote is recorded — otherwise the next inbound import
        # compares against a stale skillnote_version_id and re-diverges.
        link.skillnote_version_id = latest
        link.conflict_state = "resolved"

    elif body.resolution == "keep_claude_ai":
        # If we have a staged inbound version (the new post-22d path),
        # promote it directly — no need to wait for a fetch_one
        # round-trip via the extension. Falls back to fetch_one ONLY
        # when no staged version exists, which can happen if the
        # divergence was flagged on an older code path.
        if staged_inbound is not None and link.skillnote_skill_id is not None:
            skill = db.get(Skill, link.skillnote_skill_id)
            if skill is None:
                raise api_error(404, "SKILL_NOT_FOUND", "Linked skill was deleted")
            # Flip current latest → not-latest, promote staged → latest.
            db.execute(
                SkillContentVersion.__table__.update()
                .where(SkillContentVersion.skill_id == skill.id)
                .where(SkillContentVersion.is_latest.is_(True))
                .values(is_latest=False)
            )
            staged_inbound.is_latest = True
            # Apply the staged content + metadata to the parent Skill row.
            skill.content_md = staged_inbound.content_md
            skill.name = staged_inbound.title
            skill.description = staged_inbound.description
            # A5: never move current_version backwards — an intervening save
            # may have advanced it past the staged version's number; reusing a
            # lower number would collide on the next save.
            skill.current_version = max(skill.current_version or 0, staged_inbound.version)
            link.skillnote_version_id = staged_inbound.id
            link.staged_version_id = None
            audit_detail["promoted_version_id"] = str(staged_inbound.id)
        else:
            # No staged inbound version (divergence flagged on an older code
            # path). Under the named-group model there is no per-skill "fetch_one"
            # op the extension can run — enqueuing one would just fail three
            # times and leave the conflict unresolved. Surface a clear,
            # actionable error instead so the user knows to re-sync first.
            raise api_error(
                409,
                "CONFLICT_NEEDS_RESYNC",
                "Can't keep the claude.ai version: its content isn't staged "
                "locally yet. Run a sync to import it, then resolve again.",
            )
        link.conflict_state = "resolved"

    # 27d: emit audit row for every successful resolve so the activity
    # feed shows who picked what and (when relevant) which staged
    # version was promoted or discarded.
    write_audit(
        db,
        event="conflict_resolved",
        integration_id=link.integration_id,
        skill_id=link.skillnote_skill_id,
        detail=audit_detail,
    )

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
        # Iter 28c: dedicated kinds for op retry + manual sync nudge so
        # the activity feed can label them distinctly. Without these we
        # were piggybacking on `integration_updated` which conflated
        # everything.
        "op_retried",
        "sync_triggered",
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

    Cross-integration scope: by default, omitting integration_id returns
    queue items for ALL integrations on this SkillNote instance. The
    single-tenant self-hosted topology that SkillNote ships with treats
    this as expected behavior. Operators running a shared instance can
    set SKILLNOTE_REQUIRE_QUEUE_SCOPE=1 to require integration_id and
    reject unscoped queries with 400.
    """
    import os as _os
    if (
        integration_id is None
        and _os.environ.get("SKILLNOTE_REQUIRE_QUEUE_SCOPE") == "1"
    ):
        raise api_error(
            400,
            "INTEGRATION_ID_REQUIRED",
            "This SkillNote instance requires integration_id on /queue requests.",
        )
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
    # Bulk-resolve skill slugs so the feed renders human names instead of
    # opaque claude.ai IDs. One query for the whole page.
    skill_ids = {r.skill_id for r in rows if r.skill_id is not None}
    slugs_by_id: dict[UUID, str] = {}
    if skill_ids:
        slugs_by_id = {
            s.id: s.slug
            for s in db.execute(select(Skill).where(Skill.id.in_(skill_ids))).scalars()
        }
    return [
        AuditEventOut(
            id=r.id,
            integration_id=r.integration_id,
            event=r.event,
            skill_id=r.skill_id,
            skill_slug=slugs_by_id.get(r.skill_id) if r.skill_id else None,
            detail=r.detail or {},
            created_at=r.created_at,
        )
        for r in rows
    ]


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
    from sqlalchemy import case, cast, Date, func as _func, text as _sql_text
    from app.db.models.skill import Skill

    now = datetime.now(_tz.utc)
    cutoff_24h = now - _td(hours=24)
    cutoff_7d = now - _td(days=7)

    op = ClaudeAISyncOperation
    integ = ClaudeAIIntegration

    # Under the named-group model the only forward-sync op is publish_group
    # (one per group rebuild/push). `list` ops are reverse-sync polls — not
    # "syncs" — so counting all op kinds inflated these numbers. Scope the
    # sync metrics to publish_group so "N syncs" reflects real pushes to
    # claude.ai (and the success rate / avg-tries reflect forward sync only).
    forward = op.kind == "publish_group"
    completed_filter = (op.status == "completed") & (op.completed_at != None) & forward  # noqa: E711
    failed_filter = (op.status == "failed") & (op.completed_at != None) & forward  # noqa: E711

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
            _func.coalesce(_func.avg(case((forward, op.attempts), else_=None)), 0.0),
        ).where(op.completed_at >= cutoff_7d)
    ).one()
    syncs_7d = int(counts_7d[0])
    failed_7d = int(counts_7d[1])
    avg_attempts_7d = float(counts_7d[2])
    total_7d = syncs_7d + failed_7d
    success_rate_7d = 1.0 if total_7d == 0 else syncs_7d / total_7d

    # Top 5 most-synced skills over 7d. Joins Skill so we return
    # human-readable name/slug. This is keyed on op.skill_id, which the
    # forward-scoped `completed_filter` (publish_group, skill_id IS NULL) would
    # always exclude — so use a dedicated skill-scoped filter here instead of
    # reusing completed_filter (which would force this list permanently empty).
    top_completed = (op.status == "completed") & (op.completed_at != None) & (op.skill_id != None)  # noqa: E711
    top_rows = db.execute(
        select(
            Skill.id,
            Skill.slug,
            Skill.name,
            _func.count(op.id).label("sync_count"),
        )
        .join(op, op.skill_id == Skill.id)
        .where(top_completed)
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

    # ── Usage: how often Claude actually invoked skills on claude.ai ────────
    # Read from skill_call_events (the shared cross-agent usage table) where
    # agent_name='claude-ai'. The extension's usage scanner writes these via
    # /v1/hooks/skill-used. Wrapped in try/except so a missing table or
    # column never breaks the (sync-focused) analytics response.
    invocations_24h = 0
    invocations_7d = 0
    top_used: list[TopUsedSkillStat] = []
    try:
        inv_counts = db.execute(
            _sql_text(
                """
                SELECT
                  count(*) FILTER (WHERE created_at >= :c24) AS c24,
                  count(*) FILTER (WHERE created_at >= :c7d) AS c7d
                FROM skill_call_events
                WHERE agent_name = 'claude-ai' AND event_type = 'called'
                """
            ),
            {"c24": cutoff_24h, "c7d": cutoff_7d},
        ).one()
        invocations_24h = int(inv_counts[0] or 0)
        invocations_7d = int(inv_counts[1] or 0)

        top_rows = db.execute(
            _sql_text(
                """
                SELECT skill_slug, count(*) AS n
                FROM skill_call_events
                WHERE agent_name = 'claude-ai' AND event_type = 'called'
                  AND created_at >= :c7d
                GROUP BY skill_slug
                ORDER BY n DESC
                LIMIT 5
                """
            ),
            {"c7d": cutoff_7d},
        ).all()
        top_used = [
            TopUsedSkillStat(skill_slug=r[0], invocations=int(r[1])) for r in top_rows
        ]
    except Exception:  # noqa: BLE001
        # skill_call_events may not exist in some deployments — usage is
        # additive, never load-bearing for the sync analytics.
        pass

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
        invocations_24h=invocations_24h,
        invocations_7d=invocations_7d,
        top_used_skills_7d=top_used,
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
    # EXPECTED head is computed from the shipped Alembic scripts at runtime so
    # it never drifts as new migrations land. (It previously hardcoded an old
    # revision, so every correctly-migrated DB reported "schema out of date"
    # and the overall diagnostic verdict was permanently "warn".)
    EXPECTED_HEAD = "0025_collection_publish_ca"  # fallback if script dir unreadable
    try:
        from pathlib import Path as _Path

        from alembic.script import ScriptDirectory as _ScriptDir

        _head = _ScriptDir(
            str(_Path(__file__).resolve().parents[2] / "alembic")
        ).get_current_head()
        if _head:
            EXPECTED_HEAD = _head
    except Exception:  # pragma: no cover - keep the hardcoded fallback
        pass
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
                    # Customer-facing copy — no internal migration revision in
                    # the happy path. (The drift case below keeps the revision
                    # ids because operators need them to run the upgrade.)
                    detail="Your SkillNote database is on the latest version.",
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

    # 9. extension_endpoint_stable — if the extension reported an
    # endpoint_changed event recently, claude.ai's REST surface
    # probably moved and the extension needs an update before any sync
    # will work again. The previous diagnostic missed this entirely so
    # ops could be stuck for days with no clear signal.
    from app.db.models.claude_ai_polish import ClaudeAIAuditLog
    endpoint_changed_count = int(
        db.execute(
            select(_func.count(ClaudeAIAuditLog.id))
            .where(ClaudeAIAuditLog.event == "endpoint_changed")
            .where(ClaudeAIAuditLog.created_at >= now - _td(hours=24))
        ).scalar_one()
    )
    if endpoint_changed_count == 0:
        checks.append(
            DiagnosticCheck(
                id="extension_endpoint_stable",
                label="claude.ai REST surface stable",
                status="pass",
                detail="No endpoint-change reports in the last 24 hours.",
            )
        )
    else:
        checks.append(
            DiagnosticCheck(
                id="extension_endpoint_stable",
                label="claude.ai REST surface stable",
                status="fail",
                detail=(
                    f"{endpoint_changed_count} endpoint-change report(s) in "
                    "the last 24 hours. The SkillNote extension needs an "
                    "update — sync will stay broken until you reinstall the "
                    "latest version from the extensions/claude-ai source tree."
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


@router.get(
    "/skills/{skill_slug}/sync-status",
    response_model=SkillSyncStatusResponse,
)
def get_skill_sync_status(
    skill_slug: str,
    db: Session = Depends(get_db),
) -> SkillSyncStatusResponse:
    """Per-skill claude.ai sync snapshot for the skill-detail page.

    Returns:
      - the per-skill toggle state (claude_ai_sync_enabled)
      - every ClaudeAISkillLink touching this skill, with the linked
        integration's label + status + last-seen + direction +
        conflict state
      - count of in-flight (pending or in_progress) ops for the skill

    Keyed by slug (canonical user-facing identifier). Returns 404 if
    the slug doesn't exist.
    """
    from sqlalchemy import func as _f
    skill = db.execute(
        select(Skill).where(Skill.slug == skill_slug)
    ).scalar_one_or_none()
    if skill is None:
        raise api_error(404, "SKILL_NOT_FOUND", f"Skill {skill_slug!r} not found")

    link_rows = db.execute(
        select(
            ClaudeAISkillLink.integration_id,
            ClaudeAIIntegration.browser_label,
            ClaudeAIIntegration.status,
            ClaudeAISkillLink.claude_ai_skill_id,
            ClaudeAISkillLink.claude_ai_version,
            ClaudeAISkillLink.conflict_state,
            ClaudeAISkillLink.last_seen_at,
            ClaudeAISkillLink.direction,
        )
        .join(
            ClaudeAIIntegration,
            ClaudeAIIntegration.id == ClaudeAISkillLink.integration_id,
        )
        .where(ClaudeAISkillLink.skillnote_skill_id == skill.id)
        .order_by(ClaudeAISkillLink.last_seen_at.desc().nullslast())
    ).all()

    links = [
        SkillSyncLinkStat(
            integration_id=row[0],
            integration_label=row[1],
            integration_status=row[2],  # type: ignore[arg-type]
            claude_ai_skill_id=row[3],
            claude_ai_version=row[4],
            conflict_state=row[5],  # type: ignore[arg-type]
            last_seen_at=row[6],
            direction=row[7],  # type: ignore[arg-type]
        )
        for row in link_rows
    ]

    pending_count = int(
        db.execute(
            select(_f.count(ClaudeAISyncOperation.id))
            .where(ClaudeAISyncOperation.skill_id == skill.id)
            .where(ClaudeAISyncOperation.status.in_(("pending", "in_progress")))
        ).scalar_one()
    )

    return SkillSyncStatusResponse(
        skill_id=skill.id,
        skill_slug=skill.slug,
        claude_ai_sync_enabled=bool(getattr(skill, "claude_ai_sync_enabled", True)),
        links=links,
        pending_op_count=pending_count,
    )


@router.patch("/skills/{skill_ref}/sync", status_code=204)
def toggle_skill_sync(
    skill_ref: str,
    body: _SkillSyncToggleRequest,
    db: Session = Depends(get_db),
) -> Response:
    """Flip the per-skill claude.ai sync toggle.

    Used by the skill detail page to exclude specific skills (e.g. local
    dev experiments, sensitive content) from the connector. Disabling a
    skill that's already synced does NOT delete it from claude.ai — that
    requires an explicit delete. Future uploads simply stop firing.

    Accepts either the skill UUID or its slug. The frontend's offline-first
    store often holds a skill record without its backend UUID, so resolving
    by slug lets the per-skill toggle work in that common case too.
    """
    skill = None
    try:
        skill = db.get(Skill, UUID(skill_ref))
    except (ValueError, AttributeError):
        skill = None
    if skill is None:
        skill = db.execute(
            select(Skill).where(Skill.slug == skill_ref)
        ).scalar_one_or_none()
    if skill is None:
        raise api_error(404, "SKILL_NOT_FOUND", f"Skill {skill_ref} not found")
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

    # Bounded read: cap the in-memory buffer at the configured bundle limit
    # so a malicious/large upload can't OOM the worker (the manual publish
    # path enforces the same cap). Read one byte past the limit to detect
    # oversize without buffering the whole body.
    from app.core.config import settings as _settings
    _max = _settings.max_bundle_size_bytes
    raw = bundle.file.read(_max + 1)
    if len(raw) > _max:
        raise api_error(413, "BUNDLE_TOO_LARGE", "Bundle exceeds size limit")
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

    # Per-skill opt-out: if the operator disabled claude.ai sync for this
    # EXISTING skill, the reverse-sync import must not overwrite it — that
    # opt-out is a product promise (honored on the outbound path too). Ack
    # the op as handled (created=False, no mutation) so it isn't retried.
    if not created_new_skill and not getattr(skill, "claude_ai_sync_enabled", True):
        from app.services.claude_ai_sync import write_audit as _write_audit
        _write_audit(
            db,
            event="skill_imported",
            integration_id=integ.id,
            skill_id=skill.id,
            detail={
                "claude_ai_skill_id": claude_ai_skill_id,
                "applied": False,
                "reason": "sync_disabled",
            },
        )
        db.commit()
        return ImportedSkillResponse(skillnote_skill_id=skill.id, created=False)

    # Capture the local "latest version BEFORE this import" so we can
    # distinguish "local was changed by user between syncs" from "local
    # change was caused by this import itself." Used by the conflict
    # detector below.
    pre_import_latest_id = db.execute(
        select(SkillContentVersion.id)
        .where(SkillContentVersion.skill_id == skill.id)
        .where(SkillContentVersion.is_latest.is_(True))
    ).scalar_one_or_none()

    # 4. Look up the existing link FIRST so the conflict check can run
    #    BEFORE we mutate local skill state.
    from app.services.claude_ai_sync import (
        detect_link_divergence,
        enqueue_skill_upload,
        write_audit,
    )

    existing_link = db.execute(
        select(ClaudeAISkillLink).where(
            ClaudeAISkillLink.integration_id == integ.id,
            ClaudeAISkillLink.claude_ai_skill_id == claude_ai_skill_id,
        )
    ).scalar_one_or_none()

    # C2: an inbound import that collides on slug with a PRE-EXISTING local
    # skill that has NO link to this claude.ai skill must NOT silently
    # overwrite it. Without a link we have no evidence the local skill is the
    # same thing — just a slug coincidence — so a sync-scoped bearer could
    # otherwise clobber arbitrary local skills by colliding on their slug.
    # Refuse; the operator can rename one side or opt in explicitly.
    if existing_link is None and not created_new_skill:
        write_audit(
            db,
            event="skill_imported",
            integration_id=integ.id,
            skill_id=skill.id,
            detail={
                "claude_ai_skill_id": claude_ai_skill_id,
                "applied": False,
                "reason": "slug_collision_unlinked",
            },
        )
        db.commit()
        raise api_error(
            409,
            "SLUG_COLLISION_UNLINKED",
            f"A local skill '{skill.slug}' already exists and isn't linked to "
            "this claude.ai skill. Rename one side, or enable sync for it first.",
        )

    outcome = "no_conflict"
    if existing_link is not None and not created_new_skill:
        # Pass the integration so policy ('ask' | 'skillnote_wins' |
        # 'claude_ai_wins') decides the right behavior.
        outcome = detect_link_divergence(
            db,
            link=existing_link,
            incoming_claude_ai_version=claude_ai_version,
            skillnote_version_id=pre_import_latest_id,
            conflict_policy=integ.conflict_policy or "ask",
        )

    # 5. Apply the inbound content based on the outcome.
    #
    # auto_keep_skillnote: discard the inbound entirely (local wins).
    # Enqueue an outbound push so claude.ai picks up the local content
    # next tick — this is what makes the policy actually self-heal.
    if outcome == "auto_keep_skillnote":
        assert existing_link is not None
        existing_link.last_seen_at = now
        # Re-push the local latest. This is fire-and-forget; the next
        # tick of the extension picks it up.
        if pre_import_latest_id is not None:
            enqueue_skill_upload(
                db,
                skill_id=skill.id,
                version_id=pre_import_latest_id,
                name=skill.name,
                description=skill.description,
                integrations=[integ],
            )
        write_audit(
            db,
            event="skill_imported",
            integration_id=integ.id,
            skill_id=skill.id,
            detail={
                "claude_ai_skill_id": claude_ai_skill_id,
                "new_skill": False,
                "applied": False,
                "auto_resolution": "keep_skillnote",
            },
        )
        db.commit()
        return ImportedSkillResponse(skillnote_skill_id=skill.id, created=False)

    # diverged_ask: stash the inbound version as non-latest so the user
    # can pick a winner via the UI. CRITICAL: don't overwrite local skill
    # CONTENT (content_md / latest row) — pre-fix behavior silently clobbered
    # local edits at this point.
    if outcome == "diverged_ask":
        # A4: if this link was already diverged with a staged version (a
        # re-import while a resolution is still pending), drop the prior staged
        # row before staging the new one — otherwise every re-import orphans a
        # version and leaks (skill_id, version) numbers.
        if existing_link is not None and existing_link.staged_version_id is not None:
            prior_staged = db.get(SkillContentVersion, existing_link.staged_version_id)
            if prior_staged is not None and not prior_staged.is_latest:
                db.delete(prior_staged)
                db.flush()
        next_ver = (skill.current_version or 0) + 1
        new_version = SkillContentVersion(
            id=_uuid.uuid4(),
            skill_id=skill.id,
            version=next_ver,
            title=parsed_name,
            description=parsed_description,
            content_md=content_md,
            collections=[],
            is_latest=False,  # staged — user resolves via /resolve
        )
        db.add(new_version)
        # Reserve the version NUMBER (counter only — not the latest-content
        # pointer) so a later apply or a second inbound import can't allocate
        # the same version and create two rows sharing (skill_id, version),
        # which would make version history / restore ambiguous. The latest
        # content row is left untouched; keep_claude_ai's promotion later sets
        # current_version to this same number (a no-op), and keep_skillnote's
        # discard leaves it advanced (monotonic, gap-tolerant — fine).
        skill.current_version = next_ver
        db.flush()
        # Mark the link as diverged but keep skillnote_version_id pointing
        # at the LOCAL pre-import latest so "Keep SkillNote" pushes the
        # untouched local content back. Track the staged inbound version
        # via claude_ai_version (already updated by the detector).
        assert existing_link is not None
        existing_link.last_seen_at = now
        existing_link.claude_ai_version = claude_ai_version
        existing_link.direction = "both"
        existing_link.staged_version_id = new_version.id
        write_audit(
            db,
            event="skill_imported",
            integration_id=integ.id,
            skill_id=skill.id,
            detail={
                "claude_ai_skill_id": claude_ai_skill_id,
                "new_skill": False,
                "applied": False,
                "staged_version_id": str(new_version.id),
            },
        )
        db.commit()
        return ImportedSkillResponse(skillnote_skill_id=skill.id, created=False)

    # no_conflict / auto_keep_claude_ai / brand-new skill: normal apply.
    # Inbound becomes the new latest; local skill fields are updated.
    if not created_new_skill:
        skill.name = parsed_name
        skill.description = parsed_description
        skill.content_md = content_md

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
    db.flush()

    # 6. Upsert the link.
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
        existing_link.skillnote_skill_id = skill.id
        existing_link.skillnote_version_id = new_version.id
        existing_link.claude_ai_version = claude_ai_version
        existing_link.last_seen_at = now
        existing_link.direction = "both"

    write_audit(
        db,
        event="skill_imported",
        integration_id=integ.id,
        skill_id=skill.id,
        detail={
            "claude_ai_skill_id": claude_ai_skill_id,
            "new_skill": created_new_skill,
            "applied": True,
            **({"auto_resolution": "keep_claude_ai"} if outcome == "auto_keep_claude_ai" else {}),
        },
    )
    db.commit()
    return ImportedSkillResponse(skillnote_skill_id=skill.id, created=created_new_skill)


# ── Maintenance endpoint (admin-triggered + periodic) ─────────────────────────


@router.post("/admin/cleanup-expired-pairings", status_code=200)
def cleanup_expired_pairings(db: Session = Depends(get_db)) -> dict:
    """Periodic maintenance: expire stale pending pairings + reclaim orphaned
    `in_progress` sync ops.

    Safe to call from a cron job (e.g. every 5 minutes); the same work runs
    automatically in the API's background loop. Returns counts so monitoring
    can graph the rates.
    """
    from app.services.claude_ai_sync import (
        expire_stale_pairings,
        reclaim_stale_operations,
    )
    expired = expire_stale_pairings(db)
    reclaimed = reclaim_stale_operations(db)
    db.commit()
    return {"expired": expired, "reclaimed": reclaimed}
