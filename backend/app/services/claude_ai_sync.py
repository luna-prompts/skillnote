"""Service helpers for the claude.ai connector.

Two responsibilities:

  1. Token issuance + verification — the extension sends raw tokens; we
     store only sha256 hashes. Compared via constant-time equality.

  2. Sync-op enqueueing — when a SkillNote skill changes, fan out one
     operation per active integration so the extension picks it up on the
     next poll. Called from the publish/delete endpoints (Phase 1b will
     wire those in; the helper exists today so the contract is locked).
"""

import hashlib
import hmac
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.db.models.claude_ai import (
    ClaudeAIIntegration,
    ClaudeAISkillLink,
    ClaudeAISyncOperation,
)
from app.db.models.claude_ai_polish import (
    ClaudeAIAuditLog,
    ClaudeAIPairAttempt,
)

# Pairing codes are read aloud and typed by humans — avoid visually ambiguous
# glyphs (0/O, 1/I/L) so a misread doesn't produce a wrong-but-valid code.
_PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
_PAIRING_CODE_LENGTH = 6
_PAIRING_TTL = timedelta(minutes=10)


def generate_pairing_code() -> str:
    """Return a 6-char human-friendly code (no 0/O/1/I/L confusion)."""
    return "".join(secrets.choice(_PAIRING_CODE_ALPHABET) for _ in range(_PAIRING_CODE_LENGTH))


def generate_token() -> str:
    """Return a 32-byte url-safe random string (the wire token).

    `secrets.token_urlsafe(32)` produces ~43 chars of ~256 bits of entropy —
    well past the threshold where guessing is meaningful.
    """
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """sha256 hex digest. The function name says hash, not encrypt — we
    intentionally cannot recover the raw token from the stored value."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_token(raw: str, stored_hash: str) -> bool:
    """Constant-time hash comparison.

    Without `compare_digest` an attacker could mount a timing attack to
    learn the first N matching characters of the stored hash.
    """
    return hmac.compare_digest(hash_token(raw), stored_hash)


def pairing_expiry() -> datetime:
    """Pairing codes expire 10 minutes after issue. Tight enough to limit
    the window for shoulder-surfing the code; long enough to let a user
    switch tabs without panic."""
    return datetime.now(timezone.utc) + _PAIRING_TTL


# ── Integration lookups ───────────────────────────────────────────────────────


def find_integration_by_extension_token(
    db: Session, raw_token: str
) -> Optional[ClaudeAIIntegration]:
    """Resolve a bearer token to its integration row.

    We hash first, then SELECT by the hash — never search-by-prefix or
    similar leaky comparison. Returns None for unknown / expired tokens.
    """
    if not raw_token:
        return None
    token_hash = hash_token(raw_token)
    return db.execute(
        select(ClaudeAIIntegration).where(
            ClaudeAIIntegration.extension_token_hash == token_hash,
            ClaudeAIIntegration.status.in_(("active", "cookie_expired", "error")),
        )
    ).scalar_one_or_none()


def find_pending_pairing_by_token(
    db: Session, raw_pairing_token: str
) -> Optional[ClaudeAIIntegration]:
    """Resolve a pairing-token to its (pending) integration row."""
    if not raw_pairing_token:
        return None
    token_hash = hash_token(raw_pairing_token)
    return db.execute(
        select(ClaudeAIIntegration).where(
            ClaudeAIIntegration.pairing_token_hash == token_hash,
            ClaudeAIIntegration.status == "pending_approval",
        )
    ).scalar_one_or_none()


def find_pending_pairing_by_code(
    db: Session, pairing_code: str
) -> Optional[ClaudeAIIntegration]:
    """Resolve the human-typed pairing code to its (pending) row.

    Codes are short (6 chars) so they live in plaintext on the row — the
    short window + low entropy makes a hash pointless. The pairing_token
    (long, opaque) is what actually authenticates the extension's poll.
    """
    if not pairing_code:
        return None
    normalized = pairing_code.strip().upper()
    return db.execute(
        select(ClaudeAIIntegration).where(
            ClaudeAIIntegration.pairing_code == normalized,
            ClaudeAIIntegration.status == "pending_approval",
        )
    ).scalar_one_or_none()


# ── Sync op enqueueing ────────────────────────────────────────────────────────


def active_integrations_for_sync(db: Session) -> list[ClaudeAIIntegration]:
    """Every integration eligible to receive new sync ops.

    `cookie_expired` integrations still get ops enqueued — they'll fire as
    soon as the user re-logs into claude.ai. Avoids the alternative trap of
    silently dropping changes during the expiration window.
    """
    return list(
        db.execute(
            select(ClaudeAIIntegration).where(
                ClaudeAIIntegration.status.in_(("active", "cookie_expired"))
            )
        )
        .scalars()
        .all()
    )


def _has_pending_op(
    db: Session, integration_id: UUID, skill_id: UUID, kind: str
) -> bool:
    """Coalesce duplicate enqueues. If a user mashes Save 3 times in a row
    we don't want three pending uploads — the latest pending one will pull
    the current latest version when it runs."""
    return (
        db.execute(
            select(ClaudeAISyncOperation.id).where(
                ClaudeAISyncOperation.integration_id == integration_id,
                ClaudeAISyncOperation.skill_id == skill_id,
                ClaudeAISyncOperation.kind == kind,
                ClaudeAISyncOperation.status.in_(("pending", "in_progress")),
            )
        ).first()
        is not None
    )


_SYNCABLE_STATUSES = frozenset({"active", "cookie_expired"})


# ── Periodic cleanup ──────────────────────────────────────────────────────────


def expire_stale_pairings(db: Session) -> int:
    """Mark expired pending pairings and emit audit events.

    Called from a periodic job (every ~5 minutes) so the integrations
    table doesn't accumulate pending_approval rows that no one will ever
    finish. Returns the number of rows expired.
    """
    cutoff = datetime.now(timezone.utc) - _PAIRING_GRACE
    stale = list(db.execute(
        select(ClaudeAIIntegration).where(
            ClaudeAIIntegration.status == "pending_approval",
            ClaudeAIIntegration.pairing_expires_at < cutoff,
        )
    ).scalars().all())
    for integ in stale:
        # Use 'error' state — we don't want a discoverable expired row
        # left dangling. Audit event records the reason.
        integ.status = "error"
        integ.pairing_code = None
        integ.pairing_token_hash = None
        write_audit(
            db,
            event="pair_expired",
            integration_id=integ.id,
            detail={"browser_label": integ.browser_label or ""},
        )
    return len(stale)


# ── Conflict auto-detection ───────────────────────────────────────────────────


def detect_link_divergence(
    db: Session,
    *,
    link: ClaudeAISkillLink,
    incoming_claude_ai_version: Optional[str],
    skillnote_version_id: Optional[UUID] = None,
) -> bool:
    """Mark a link as 'diverged' when both sides have changed since last sync.

    Called during inbound import. If the link already has a recorded
    claude_ai_version that differs from the incoming version, AND the
    SkillNote-side version has advanced beyond what we last recorded,
    both sides changed → conflict.

    Returns True if the link was newly marked diverged.
    """
    if link.conflict_state == "diverged":
        return False
    remote_changed = (
        link.claude_ai_version is not None
        and incoming_claude_ai_version is not None
        and link.claude_ai_version != incoming_claude_ai_version
    )
    local_changed = (
        link.skillnote_version_id is not None
        and skillnote_version_id is not None
        and link.skillnote_version_id != skillnote_version_id
    )
    if remote_changed and local_changed:
        link.conflict_state = "diverged"
        write_audit(
            db,
            event="conflict_detected",
            integration_id=link.integration_id,
            skill_id=link.skillnote_skill_id,
            detail={
                "claude_ai_skill_id": link.claude_ai_skill_id,
                "local_version": str(skillnote_version_id) if skillnote_version_id else None,
                "remote_version": incoming_claude_ai_version,
            },
        )
        return True
    return False


# ── Audit log ─────────────────────────────────────────────────────────────────


def write_audit(
    db: Session,
    *,
    event: str,
    integration_id: Optional[UUID] = None,
    skill_id: Optional[UUID] = None,
    detail: Optional[dict[str, Any]] = None,
    source_ip: Optional[str] = None,
) -> ClaudeAIAuditLog:
    """Append an event to the connector audit log.

    Never raises on db errors — audit logging must never block the
    primary operation. The caller is expected to handle commit semantics.
    """
    row = ClaudeAIAuditLog(
        integration_id=integration_id,
        event=event,
        skill_id=skill_id,
        detail=detail or {},
        source_ip=source_ip,
    )
    db.add(row)
    return row


def query_audit(
    db: Session,
    *,
    integration_id: Optional[UUID] = None,
    event: Optional[str] = None,
    limit: int = 100,
    before: Optional[datetime] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    skill_id: Optional[UUID] = None,
) -> list[ClaudeAIAuditLog]:
    """Paginated audit-log query for the activity feed UI.

    ``since`` / ``until`` define an inclusive date window for compliance
    queries ("show me everything between Mar 1 and Mar 14"). ``skill_id``
    scopes to events that involved a specific skill — useful for
    debugging "why did this skill keep failing?" without scrolling the
    entire log. All filters AND together.
    """
    stmt = select(ClaudeAIAuditLog).order_by(desc(ClaudeAIAuditLog.created_at))
    if integration_id is not None:
        stmt = stmt.where(ClaudeAIAuditLog.integration_id == integration_id)
    if event is not None:
        stmt = stmt.where(ClaudeAIAuditLog.event == event)
    if before is not None:
        stmt = stmt.where(ClaudeAIAuditLog.created_at < before)
    if since is not None:
        stmt = stmt.where(ClaudeAIAuditLog.created_at >= since)
    if until is not None:
        stmt = stmt.where(ClaudeAIAuditLog.created_at <= until)
    if skill_id is not None:
        stmt = stmt.where(ClaudeAIAuditLog.skill_id == skill_id)
    stmt = stmt.limit(min(max(limit, 1), 500))
    return list(db.execute(stmt).scalars().all())


# ── Rate limiting (pair endpoint) ─────────────────────────────────────────────


# Tuned to defeat brute-force pairing-code enumeration. Codes are 6 chars
# over 31 glyphs (~887M codes), so 60 attempts/minute gives the attacker
# vanishingly low success probability even before lockout.
_PAIR_RATE_LIMIT_PER_IP = 60
_PAIR_RATE_WINDOW = timedelta(minutes=1)

# Pairing rows past their expiry that no extension ever redeemed.
# Pruned by the scheduled cleanup so the integrations table doesn't
# accumulate stale pending_approval rows forever.
_PAIRING_GRACE = timedelta(hours=1)


class PairRateLimitExceeded(Exception):
    """Raised by record_pair_attempt when the per-IP limit is breached."""


def record_pair_attempt(
    db: Session, *, source_ip: Optional[str], endpoint: str
) -> None:
    """Record an attempt and enforce per-IP rate limit.

    Strategy: sliding-window count over the most recent N seconds. If the
    count for this IP in the window is already >= limit, raise without
    inserting (so we don't double-count the rejected request).

    Caller (the API handler) catches PairRateLimitExceeded and returns 429.

    Disabled when `SKILLNOTE_DISABLE_PAIR_RATE_LIMIT=1` (used in test
    runs where many pair attempts back-to-back are expected). Never set
    in production.
    """
    import os as _os
    if _os.environ.get("SKILLNOTE_DISABLE_PAIR_RATE_LIMIT") == "1":
        return
    if source_ip is None:
        # Unknown IP — be conservative, don't enforce. Production should
        # always have an IP via X-Forwarded-For; if absent, the rate limit
        # would lump all unknown IPs into one bucket which is unfair.
        return

    window_start = datetime.now(timezone.utc) - _PAIR_RATE_WINDOW
    count = db.execute(
        select(ClaudeAIPairAttempt.id)
        .where(ClaudeAIPairAttempt.source_ip == source_ip)
        .where(ClaudeAIPairAttempt.created_at > window_start)
        .limit(_PAIR_RATE_LIMIT_PER_IP + 1)
    ).all()
    if len(count) >= _PAIR_RATE_LIMIT_PER_IP:
        raise PairRateLimitExceeded(
            f"Too many pairing attempts from {source_ip}; wait a minute and retry"
        )

    db.add(
        ClaudeAIPairAttempt(
            source_ip=source_ip,
            endpoint=endpoint,
        )
    )


# ── Sync op enqueueing ────────────────────────────────────────────────────────


def enqueue_skill_upload(
    db: Session,
    skill_id: UUID,
    version_id: UUID,
    name: str,
    description: str,
    integrations: Optional[Iterable[ClaudeAIIntegration]] = None,
) -> list[ClaudeAISyncOperation]:
    """Fan out one upload op per active integration with matching scope.

    Returns the freshly-created ops (or empty list if all were coalesced).
    Caller is responsible for db.commit() — keeps this composable with
    larger transactions in the publish endpoint.

    Defense in depth: even when a caller passes a specific integration list
    (e.g. resolve_conflict), this helper still filters by status so a
    disconnected integration never receives ops by accident.
    """
    candidates = list(integrations) if integrations is not None else active_integrations_for_sync(db)
    created: list[ClaudeAISyncOperation] = []
    for integ in candidates:
        if integ.status not in _SYNCABLE_STATUSES:
            continue
        if _has_pending_op(db, integ.id, skill_id, "upload"):
            # Replace the in-flight op's payload with the latest version
            # so when it does run, it pushes the current content (not the
            # stale one queued earlier).
            existing = db.execute(
                select(ClaudeAISyncOperation).where(
                    ClaudeAISyncOperation.integration_id == integ.id,
                    ClaudeAISyncOperation.skill_id == skill_id,
                    ClaudeAISyncOperation.kind == "upload",
                    ClaudeAISyncOperation.status == "pending",
                )
            ).scalar_one_or_none()
            if existing is not None:
                existing.payload = {
                    "version_id": str(version_id),
                    "name": name,
                    "description": description,
                }
            continue
        op = ClaudeAISyncOperation(
            integration_id=integ.id,
            kind="upload",
            skill_id=skill_id,
            payload={
                "version_id": str(version_id),
                "name": name,
                "description": description,
            },
        )
        db.add(op)
        created.append(op)
    return created


def enqueue_skill_delete(
    db: Session,
    skill_id: UUID,
    integrations: Optional[Iterable[ClaudeAIIntegration]] = None,
) -> list[ClaudeAISyncOperation]:
    """Fan out one delete op per integration that has this skill linked.

    Only enqueues for integrations with an existing link — there's no point
    asking claude.ai to delete a skill it never knew about.

    Important: delete ops are enqueued WITHOUT a skill_id FK. The skill is
    typically deleted in the same transaction as the enqueue, and the
    skills→sync_operations FK is ondelete=CASCADE — so a delete op with
    skill_id set would be wiped out by the cascade in the same commit,
    making the delete a no-op. The claude.ai-side ID lives in the payload
    where the extension can read it.

    The original skill_id is preserved in the payload as
    `skillnote_skill_id` for forensics / dedup, but not as an FK.
    """
    rows = db.execute(
        select(ClaudeAISkillLink.integration_id, ClaudeAISkillLink.claude_ai_skill_id)
        .where(ClaudeAISkillLink.skillnote_skill_id == skill_id)
    ).all()
    created: list[ClaudeAISyncOperation] = []
    for integration_id, claude_ai_skill_id in rows:
        # Dedup against existing pending delete ops for the same claude.ai
        # skill — without skill_id we can't use _has_pending_op directly.
        existing = db.execute(
            select(ClaudeAISyncOperation.id).where(
                ClaudeAISyncOperation.integration_id == integration_id,
                ClaudeAISyncOperation.kind == "delete",
                ClaudeAISyncOperation.status.in_(("pending", "in_progress")),
                ClaudeAISyncOperation.payload["claude_ai_skill_id"].astext == claude_ai_skill_id,
            )
        ).first()
        if existing is not None:
            continue
        op = ClaudeAISyncOperation(
            integration_id=integration_id,
            kind="delete",
            skill_id=None,  # see docstring
            payload={
                "claude_ai_skill_id": claude_ai_skill_id,
                "skillnote_skill_id": str(skill_id),  # forensics only
            },
        )
        db.add(op)
        created.append(op)
    return created


def enqueue_periodic_list(
    db: Session, integrations: Optional[Iterable[ClaudeAIIntegration]] = None
) -> list[ClaudeAISyncOperation]:
    """One `list` op per active integration. Drives reverse-sync polling.

    Called from an APScheduler tick. Coalesces against any already-pending
    list op for the same integration so a long-blocked queue doesn't grow
    list ops faster than they drain.
    """
    candidates = list(integrations) if integrations is not None else active_integrations_for_sync(db)
    created: list[ClaudeAISyncOperation] = []
    for integ in candidates:
        existing = db.execute(
            select(ClaudeAISyncOperation.id).where(
                ClaudeAISyncOperation.integration_id == integ.id,
                ClaudeAISyncOperation.kind == "list",
                ClaudeAISyncOperation.status.in_(("pending", "in_progress")),
            )
        ).first()
        if existing is not None:
            continue
        op = ClaudeAISyncOperation(
            integration_id=integ.id,
            kind="list",
        )
        db.add(op)
        created.append(op)
    return created


# ── Integration counters (for the status response) ────────────────────────────


def integration_counters(db: Session, integration_id: UUID) -> dict[str, int]:
    """Compose pending/failed/linked counts for a single integration.

    Uses COUNT(*) at the DB rather than fetching all IDs — old code
    loaded up to 100k rows per integration to call `len()`, which
    became expensive on busy instances.
    """
    from sqlalchemy import func as _func
    pending = db.execute(
        select(_func.count(ClaudeAISyncOperation.id))
        .where(
            ClaudeAISyncOperation.integration_id == integration_id,
            ClaudeAISyncOperation.status.in_(("pending", "in_progress")),
        )
    ).scalar_one()
    failed = db.execute(
        select(_func.count(ClaudeAISyncOperation.id))
        .where(
            ClaudeAISyncOperation.integration_id == integration_id,
            ClaudeAISyncOperation.status == "failed",
        )
    ).scalar_one()
    linked = db.execute(
        select(_func.count(ClaudeAISkillLink.id))
        .where(ClaudeAISkillLink.integration_id == integration_id)
    ).scalar_one()
    return {
        "pending_op_count": int(pending),
        "failed_op_count": int(failed),
        "linked_skill_count": int(linked),
    }


def bulk_integration_counters(
    db: Session, integration_ids: list[UUID]
) -> dict[UUID, dict[str, int]]:
    """N+1-free counters for many integrations at once.

    The list_integrations endpoint calls this with all current integration
    IDs — replaces 3*N queries with 3 queries total, regardless of N.
    """
    from sqlalchemy import func as _func, case
    if not integration_ids:
        return {}

    # Operations: GROUP BY integration_id + status; SUM by bucket.
    op_rows = db.execute(
        select(
            ClaudeAISyncOperation.integration_id,
            _func.sum(
                case(
                    (
                        ClaudeAISyncOperation.status.in_(("pending", "in_progress")),
                        1,
                    ),
                    else_=0,
                )
            ).label("pending"),
            _func.sum(
                case(
                    (ClaudeAISyncOperation.status == "failed", 1),
                    else_=0,
                )
            ).label("failed"),
        )
        .where(ClaudeAISyncOperation.integration_id.in_(integration_ids))
        .group_by(ClaudeAISyncOperation.integration_id)
    ).all()

    link_rows = db.execute(
        select(
            ClaudeAISkillLink.integration_id,
            _func.count(ClaudeAISkillLink.id).label("linked"),
        )
        .where(ClaudeAISkillLink.integration_id.in_(integration_ids))
        .group_by(ClaudeAISkillLink.integration_id)
    ).all()

    out: dict[UUID, dict[str, int]] = {
        i: {"pending_op_count": 0, "failed_op_count": 0, "linked_skill_count": 0}
        for i in integration_ids
    }
    for row in op_rows:
        out[row.integration_id]["pending_op_count"] = int(row.pending or 0)
        out[row.integration_id]["failed_op_count"] = int(row.failed or 0)
    for row in link_rows:
        out[row.integration_id]["linked_skill_count"] = int(row.linked or 0)
    return out
