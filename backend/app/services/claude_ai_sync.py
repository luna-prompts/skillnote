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


# Ops are leased to one extension at fetch time (status flips to in_progress).
# If that extension never reports a result — browser closed, service worker
# killed, machine slept — the op would otherwise sit in_progress forever:
# the fetch path only returns `pending`, so it's never retried, and it's
# invisible to `pending_op_count`. The lease window is generous (the extension
# ticks every 60s and ops complete in seconds) so we never reclaim an op that
# is legitimately still being worked.
_OP_LEASE = timedelta(minutes=10)
_MAX_OP_ATTEMPTS = 3  # must match complete_operation's retry budget


def reclaim_stale_operations(db: Session, *, now: Optional[datetime] = None) -> int:
    """Reclaim orphaned `in_progress` ops whose lease has expired.

    Ops still under the retry budget go back to `pending` (the next fetch
    retries them); ops that have exhausted their attempts are marked `failed`
    so they surface in the UI instead of silently stalling. Returns the
    number of ops reclaimed. Caller commits.
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - _OP_LEASE
    stale = list(
        db.execute(
            select(ClaudeAISyncOperation).where(
                ClaudeAISyncOperation.status == "in_progress",
                ClaudeAISyncOperation.started_at.is_not(None),
                ClaudeAISyncOperation.started_at < cutoff,
            )
        )
        .scalars()
        .all()
    )
    for op in stale:
        if op.attempts >= _MAX_OP_ATTEMPTS:
            op.status = "failed"
            op.completed_at = now
            op.last_error = (
                "Timed out — the browser didn't report a result within the "
                "sync window. Re-pair the browser or use Retry."
            )
            write_audit(
                db,
                event="op_failed",
                integration_id=op.integration_id,
                skill_id=op.skill_id,
                detail={"op_id": str(op.id), "kind": op.kind, "reason": "lease_timeout"},
            )
        else:
            # Back to pending — the next fetch picks it up and retries.
            op.status = "pending"
            op.started_at = None
            op.last_error = "Reclaimed after a stalled attempt; will retry."
            write_audit(
                db,
                event="op_retried",
                integration_id=op.integration_id,
                skill_id=op.skill_id,
                detail={"op_id": str(op.id), "kind": op.kind, "reason": "lease_timeout"},
            )
    return len(stale)


# ── Conflict auto-detection ───────────────────────────────────────────────────


# Outcome of running conflict detection against an inbound import.
#  - "no_conflict" : either no divergence OR the link was already diverged
#  - "diverged_ask": both sides changed, policy=ask → stash inbound
#                     as non-latest, leave local untouched
#  - "auto_keep_skillnote": both sides changed, policy=skillnote_wins →
#                     DROP the inbound import (local wins). Caller must
#                     also enqueue an outbound push so claude.ai picks
#                     up the local content.
#  - "auto_keep_claude_ai": both sides changed, policy=claude_ai_wins →
#                     apply inbound import as latest (overwrites local).
ConflictOutcome = str  # one of the literals above


def detect_link_divergence(
    db: Session,
    *,
    link: ClaudeAISkillLink,
    incoming_claude_ai_version: Optional[str],
    skillnote_version_id: Optional[UUID] = None,
    conflict_policy: str = "ask",
) -> ConflictOutcome:
    """Detect divergence and decide what to do based on the integration's
    `conflict_policy`.

    Called during inbound import. If the link already has a recorded
    claude_ai_version that differs from the incoming version, AND the
    SkillNote-side version has advanced beyond what we last recorded,
    both sides changed → conflict.

    Returns one of:
      - 'no_conflict'           : caller proceeds with normal inbound apply
      - 'diverged_ask'          : caller MUST NOT overwrite local; stash
                                   the inbound version as non-latest so
                                   the user can pick a winner manually
      - 'auto_keep_skillnote'   : caller must DISCARD the inbound (don't
                                   create the version, don't update skill
                                   fields) AND enqueue an outbound push
      - 'auto_keep_claude_ai'   : caller proceeds with normal inbound
                                   apply (local gets overwritten — that
                                   IS the user's chosen policy)

    The conflict_resolved audit event is emitted for both auto outcomes
    so the activity feed reflects what the policy decided.
    """
    if link.conflict_state == "diverged":
        # Already flagged and awaiting manual resolution. Re-stage the inbound
        # (diverged_ask) rather than returning "no_conflict" — "no_conflict"
        # routes the caller to the NORMAL APPLY path, which overwrites the
        # local content the divergence was protecting (silent data loss). The
        # diverged_ask path stashes the inbound as a non-latest version and
        # leaves local untouched, preserving the user's pending decision.
        return "diverged_ask"
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
    if not (remote_changed and local_changed):
        return "no_conflict"

    # ── Both sides changed — policy decides. ────────────────────────────
    detail_base = {
        "claude_ai_skill_id": link.claude_ai_skill_id,
        "local_version": str(skillnote_version_id) if skillnote_version_id else None,
        "remote_version": incoming_claude_ai_version,
    }

    if conflict_policy == "skillnote_wins":
        write_audit(
            db,
            event="conflict_resolved",
            integration_id=link.integration_id,
            skill_id=link.skillnote_skill_id,
            detail={**detail_base, "resolution": "auto_keep_skillnote"},
        )
        return "auto_keep_skillnote"

    if conflict_policy == "claude_ai_wins":
        write_audit(
            db,
            event="conflict_resolved",
            integration_id=link.integration_id,
            skill_id=link.skillnote_skill_id,
            detail={**detail_base, "resolution": "auto_keep_claude_ai"},
        )
        return "auto_keep_claude_ai"

    # Default policy 'ask' — flag for manual resolution. Critical: the
    # caller MUST NOT overwrite local content. Pre-fix behavior silently
    # lost local edits whenever an inbound import landed during a divergence.
    link.conflict_state = "diverged"
    write_audit(
        db,
        event="conflict_detected",
        integration_id=link.integration_id,
        skill_id=link.skillnote_skill_id,
        detail=detail_base,
    )
    return "diverged_ask"


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


def enqueue_group_publish(
    db: Session,
    integrations: Optional[Iterable[ClaudeAIIntegration]] = None,
) -> list[ClaudeAISyncOperation]:
    """Enqueue (coalescing) one ``publish_group`` op per active integration.

    This is the single forward-sync op for the git-free named-group model:
    SkillNote no longer pushes individual skills, it asks the extension to
    rebuild the whole "SkillNote" plugin group (all sync-enabled skills) and
    re-upload it (account-upload, overwrite=true). The group is
    replace-as-a-whole, so ONE op reconciles every add / edit / removal —
    which is why a create, an update, and a delete all funnel here.

    Coalesces against a still-``pending`` publish_group op (debounce): the op
    carries no per-skill payload, so a pending one already covers the latest
    state and we just skip. We do NOT coalesce against an ``in_progress`` op
    — that upload is mid-flight with an older bundle, so a fresh pending op is
    enqueued to capture changes made after it started. Caller commits.
    """
    candidates = (
        list(integrations) if integrations is not None else active_integrations_for_sync(db)
    )
    # Lock integration rows in a stable (id) order so concurrent enqueues can
    # never deadlock against each other (see the FOR UPDATE inside the loop).
    candidates = sorted(candidates, key=lambda i: str(i.id))
    created: list[ClaudeAISyncOperation] = []
    for integ in candidates:
        if integ.status not in _SYNCABLE_STATUSES:
            continue
        # Serialize concurrent enqueues for this integration. Without a lock,
        # two requests (e.g. a skill save racing a collection toggle) can both
        # pass the "no pending op" check below and INSERT duplicate
        # publish_group ops — making the extension rebuild and re-upload the
        # whole group twice. The row lock is held until the caller commits, so
        # a second concurrent request blocks here, then sees the first's
        # pending op and skips.
        db.execute(
            select(ClaudeAIIntegration.id)
            .where(ClaudeAIIntegration.id == integ.id)
            .with_for_update()
        ).first()
        pending = db.execute(
            select(ClaudeAISyncOperation.id).where(
                ClaudeAISyncOperation.integration_id == integ.id,
                ClaudeAISyncOperation.kind == "publish_group",
                ClaudeAISyncOperation.status == "pending",
            ).limit(1)
        ).first()
        if pending is not None:
            continue  # a pending rebuild already covers the latest state
        op = ClaudeAISyncOperation(
            integration_id=integ.id,
            kind="publish_group",
            skill_id=None,  # whole-group op, not tied to one skill
            payload={},
        )
        db.add(op)
        created.append(op)
    return created


def enqueue_skill_upload(
    db: Session,
    skill_id: UUID,
    version_id: UUID,
    name: str,
    description: str,
    integrations: Optional[Iterable[ClaudeAIIntegration]] = None,
) -> list[ClaudeAISyncOperation]:
    """Skill created/updated → rebuild & re-publish the SkillNote group.

    Kept as a thin wrapper (callers in skills.py / claude_ai.py are unchanged)
    that now delegates to :func:`enqueue_group_publish`. The per-skill args are
    accepted for signature compatibility but ignored — the group bundle is
    rebuilt fresh from the DB at execution time, so there's no per-skill
    payload to thread through.
    """
    return enqueue_group_publish(db, integrations)


def backfill_uploads_for_integration(
    db: Session,
    integ: ClaudeAIIntegration,
) -> int:
    """Enqueue a group-publish op so this integration syncs the SkillNote
    plugin group.

    Called when a browser first pairs and from the "Sync now" button. Under
    the named-group model there's nothing per-skill to backfill — one
    ``publish_group`` op rebuilds the whole group (all sync-enabled skills)
    from the DB. Only enqueues when there's actually something to publish, so
    a freshly-paired browser with zero sync-enabled skills doesn't get a
    pointless empty-bundle op. Returns the number of ops enqueued. Caller
    commits.
    """
    from app.db.models import Skill, SkillContentVersion

    if integ.status not in _SYNCABLE_STATUSES:
        return 0

    # Anything to publish? (at least one sync-enabled skill with a version)
    has_publishable = db.execute(
        select(Skill.id)
        .join(SkillContentVersion, SkillContentVersion.skill_id == Skill.id)
        .where(Skill.claude_ai_sync_enabled.is_(True))
        .where(SkillContentVersion.is_latest.is_(True))
        .limit(1)
    ).first() is not None
    if not has_publishable:
        return 0

    return len(enqueue_group_publish(db, [integ]))


def enqueue_skill_delete(
    db: Session,
    skill_id: UUID,
    integrations: Optional[Iterable[ClaudeAIIntegration]] = None,
) -> list[ClaudeAISyncOperation]:
    """Skill deleted → rebuild & re-publish the SkillNote group without it.

    Under the named-group model there is no per-skill delete on claude.ai
    (plugin skills aren't individually addressable — verified live). A removed
    skill is simply omitted from the next group bundle, so a delete funnels to
    the same :func:`enqueue_group_publish` as a create/update. ``skill_id`` is
    accepted for signature compatibility; the rebuild reads the current DB
    state (the row is typically gone by execution time, which is exactly the
    desired result).
    """
    return enqueue_group_publish(db, integrations)


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
