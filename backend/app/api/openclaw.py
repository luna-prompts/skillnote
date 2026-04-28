"""OpenClaw integration endpoints.

Provides the /v1/openclaw/context-bundle endpoint that ships the SkillNote
catalog (capped at max_skills, sorted by usage_count_30d desc then
rating_avg desc) with rich per-skill metadata (usage counts, ratings,
latest comment, deprecation flag) pre-aggregated in a constant number of
queries regardless of result-set size. The OpenClaw resolver subagent
running in the agent harness does the actual relevance picking via LLM
reasoning over this bundle — SkillNote is intentionally NOT the ranker.

Also provides POST/GET /v1/openclaw/usage for agents to log applied skills
plus task outcomes (the data that powers the context-bundle aggregations).
"""
import uuid as uuid_lib
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy import and_, cast, desc, func, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.models import AnalyticsEvent, Collection, Comment, Skill, SkillUsageEvent
from app.db.session import get_db
from app.schemas.openclaw import (
    ContextBundleCollection,
    ContextBundleRequest,
    ContextBundleResponse,
    ContextBundleSkill,
    UsageEventCreate,
    UsageEventOut,
)

# Keep `uuid` as an alias so the existing context-bundle handler continues to
# reference the module by its original name.
uuid = uuid_lib

router = APIRouter(prefix="/v1/openclaw", tags=["openclaw"])

# Separate router for /v1/openclaw-skill (no /v1/openclaw prefix).
skill_router = APIRouter(prefix="/v1", tags=["openclaw"])

_SKILL_DIR = Path(__file__).parent.parent.parent / "seed_data" / "skillnote.skill"


@skill_router.get("/openclaw-skill")
def get_openclaw_skill():
    """Return the canonical skillnote SKILL.md + version for the weekly self-update check."""
    version_file = _SKILL_DIR / "VERSION"
    skill_file = _SKILL_DIR / "SKILL.md"
    if not version_file.exists() or not skill_file.exists():
        return JSONResponse(status_code=503, content={"error": {"code": "SKILL_NOT_FOUND", "message": "skill seed data not found"}})
    return {
        "version": version_file.read_text().strip(),
        "skill": skill_file.read_text(),
    }


@router.post("/context-bundle", response_model=ContextBundleResponse)
def context_bundle(
    req: ContextBundleRequest,
    db: Session = Depends(get_db),
) -> ContextBundleResponse:
    """Return the catalog of skills (with usage / rating / comment / staleness
    metadata) that the OpenClaw resolver subagent ranks via LLM reasoning.

    SkillNote does NOT do semantic ranking server-side. The subagent reads
    the bundle, scores skills against the task summary using its own LLM
    judgment, and picks 1-5. We just over-fetch a bit, sort by a cheap
    usage+rating proxy, then truncate to ``max_skills``.
    """
    # 1. Pull a generous candidate slice. Over-fetch by 4x so the eventual
    #    in-memory sort by usage+rating has more to work with than the raw
    #    insertion order would offer; we still respect req.max_skills below.
    stmt = select(Skill)
    if req.collection_filter:
        # Skill.collections is ARRAY(Text); .any(value) compiles to
        # `value = ANY(skills.collections)` which matches membership.
        stmt = stmt.where(Skill.collections.any(req.collection_filter))
    # Deterministic ordering ensures LIMIT max_skills*4 always captures the
    # same candidate window; without ORDER BY the DB can exclude any row.
    stmt = stmt.order_by(Skill.name).limit(req.max_skills * 4)
    candidate_skills: list[Skill] = list(db.execute(stmt).scalars().all())

    # 2. Pull all collections — small set, no ranking needed.
    collections = db.query(Collection).all()

    # 3. Early-return when no skills match. We still ship collections — an
    #    empty skills list doesn't mean an empty registry of collections.
    if not candidate_skills:
        bundle_collections = [
            ContextBundleCollection(name=c.name, description=c.description)
            for c in collections
        ]
        return ContextBundleResponse(collections=bundle_collections, skills=[])

    skill_id_uuids = [s.id for s in candidate_skills]
    skill_id_strs = [str(s.id) for s in candidate_skills]

    # 4. Pre-aggregate usage_count_30d in ONE query via JSONB array unnesting.
    #    Subquery isolates the unnest so we can GROUP BY the resulting sid and
    #    filter with WHERE before grouping (cleaner than HAVING on a SRF).
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    unnest_subq = (
        select(
            func.jsonb_array_elements_text(SkillUsageEvent.skill_ids).label("sid"),
        )
        .where(SkillUsageEvent.created_at > thirty_days_ago)
        .subquery()
    )
    usage_stmt = (
        select(unnest_subq.c.sid, func.count().label("cnt"))
        .where(unnest_subq.c.sid.in_(skill_id_strs))
        .group_by(unnest_subq.c.sid)
    )
    usage_counts: dict[str, int] = {
        row.sid: row.cnt for row in db.execute(usage_stmt).all()
    }

    # 5. Pre-aggregate rating_avg in ONE query.
    rating_stmt = (
        select(Comment.skill_id, func.avg(Comment.rating).label("avg"))
        .where(Comment.skill_id.in_(skill_id_uuids))
        .where(Comment.rating.is_not(None))
        .group_by(Comment.skill_id)
    )
    rating_avgs: dict[uuid.UUID, float] = {
        row.skill_id: float(row.avg) for row in db.execute(rating_stmt).all()
    }

    # 6. Pre-aggregate latest comment per skill via DISTINCT ON.
    latest_stmt = (
        select(Comment.skill_id, Comment.body)
        .where(Comment.skill_id.in_(skill_id_uuids))
        .order_by(Comment.skill_id, desc(Comment.created_at))
        .distinct(Comment.skill_id)
    )
    latest_comments: dict[uuid.UUID, str] = {
        row.skill_id: row.body[:200] for row in db.execute(latest_stmt).all()
    }

    # 7. Pre-aggregate deprecation flag in ONE query.
    dep_stmt = (
        select(Comment.skill_id)
        .where(Comment.skill_id.in_(skill_id_uuids))
        .where(Comment.comment_type == "agent_deprecation_warning")
        .distinct()
    )
    deprecated: set[uuid.UUID] = {row.skill_id for row in db.execute(dep_stmt).all()}

    # 8. Sort by usage+rating proxy and truncate to max_skills. The subagent
    #    re-ranks via LLM reasoning on top of this — see module docstring.
    candidate_skills.sort(
        key=lambda s: (
            -int(usage_counts.get(str(s.id), 0)),  # higher usage first
            -(rating_avgs.get(s.id) or 0.0),       # higher rating first
            s.name,                                 # alphabetical tiebreak
        )
    )
    ranked_skills = candidate_skills[: req.max_skills]

    # 9. Build the response payload.
    def _staleness(skill_id, rating: float | None) -> str:
        if skill_id in deprecated:
            return "needs_review"
        if rating is not None and rating < 3.0:
            return "needs_review"
        return "healthy"

    bundle_skills = [
        ContextBundleSkill(
            id=s.id,
            slug=s.slug,
            name=s.name,
            collections=s.collections or [],
            description=s.description,
            rating_avg=rating_avgs.get(s.id),
            usage_count_30d=int(usage_counts.get(str(s.id), 0)),
            staleness_status=_staleness(s.id, rating_avgs.get(s.id)),
            recent_comments_summary=latest_comments.get(s.id),
        )
        for s in ranked_skills
    ]
    bundle_collections = [
        ContextBundleCollection(name=c.name, description=c.description)
        for c in collections
    ]
    return ContextBundleResponse(collections=bundle_collections, skills=bundle_skills)


@router.post(
    "/usage",
    response_model=UsageEventOut,
    status_code=201,
)
def create_usage_event(
    payload: UsageEventCreate,
    db: Session = Depends(get_db),
) -> SkillUsageEvent:
    """Record a single skill-usage event from an agent.

    Validation order is intentional: cheap string checks before any DB query.

    NOTE on task_summary length: the Pydantic schema caps it at 2000 chars as
    an absolute upper bound (defense in depth), but the product policy is
    >1000 → 422. Agents must summarize, not dump raw user messages. The
    runtime check below enforces the policy ceiling; the schema cap protects
    us if the schema or a future migration relaxes the explicit check.
    """
    if len(payload.task_summary) > 1000:
        raise api_error(
            422,
            "TASK_SUMMARY_TOO_LONG",
            "task_summary > 1000 chars; agents must summarize, not dump raw user messages",
        )

    # Validate collection_id exists — FK lives on collections.name (Text PK).
    # Must check before db.add() or the constraint fires as a 500 instead of 422.
    if payload.collection_id is not None:
        col_exists = db.execute(
            select(Collection.name).where(Collection.name == payload.collection_id)
        ).first()
        if not col_exists:
            raise api_error(
                422,
                "UNKNOWN_COLLECTION_ID",
                f"Collection '{payload.collection_id}' not found",
            )

    # Pre-aggregate skill_id existence check in ONE query. Compare set sizes
    # rather than iterating — cheaper and surfaces the first unknown id below.
    if payload.skill_ids:
        found_rows = db.execute(
            select(Skill.id).where(Skill.id.in_(payload.skill_ids))
        ).all()
        found = {row[0] for row in found_rows}
        for sid in payload.skill_ids:
            if sid not in found:
                raise api_error(
                    422,
                    "UNKNOWN_SKILL_ID",
                    f"Skill {sid} not found",
                )

    # Deduplicate skill_ids preserving order — duplicate entries from a single
    # event would inflate usage_count_30d in the context-bundle aggregation.
    deduped_skill_ids = list(dict.fromkeys(str(u) for u in payload.skill_ids))

    event = SkillUsageEvent(
        id=uuid_lib.uuid4(),
        agent_name=payload.agent_name,
        task_summary=payload.task_summary,
        collection_id=payload.collection_id,
        # JSONB column stores stringified UUIDs so they round-trip cleanly
        # to the context-bundle aggregation (which compares against str(s.id)).
        skill_ids=deduped_skill_ids,
        resolver_confidence=payload.resolver_confidence,
        risk_level=payload.risk_level,
        outcome=payload.outcome,
        channel=payload.channel,
        metadata_json=payload.metadata_json,
    )
    db.add(event)

    # Fan-out: one skill_call_event per skill so the analytics dashboard
    # (which reads skill_call_events) shows OpenClaw activity alongside
    # Claude Code plugin activity without any frontend changes.
    if deduped_skill_ids:
        slugs_by_id: dict[str, str] = {
            str(row.id): row.slug
            for row in db.execute(select(Skill.id, Skill.slug).where(
                Skill.id.in_(payload.skill_ids)
            )).all()
        }
        for sid in deduped_skill_ids:
            db.add(AnalyticsEvent(
                id=uuid_lib.uuid4(),
                skill_slug=slugs_by_id.get(sid),
                event_type="called",
                agent_name=payload.agent_name,
                collection_scope=payload.collection_id,
            ))

    db.commit()
    db.refresh(event)
    return event


# NOTE: Used by the Settings → OpenClaw card to detect "connected" status
# (Task 11 will hit this).
@router.get("/usage", response_model=list[UsageEventOut])
def list_usage_events(
    limit: int = Query(default=50, ge=1, le=200),
    skill_id: uuid_lib.UUID | None = None,
    since: datetime | None = None,
    before: str | None = None,
    db: Session = Depends(get_db),
) -> list[SkillUsageEvent]:
    """List recent skill-usage events.

    Cursor format for `before`: ``"{created_at_iso}:{event_id}"``. Encode this
    from the last item of the previous page (e.g. ``f"{e.created_at.isoformat()}:{e.id}"``).
    Both halves are required — id is the tiebreak when timestamps collide.
    """
    stmt = select(SkillUsageEvent).order_by(
        SkillUsageEvent.created_at.desc(),
        SkillUsageEvent.id.desc(),
    )

    if since is not None:
        stmt = stmt.where(SkillUsageEvent.created_at > since)

    if skill_id is not None:
        # JSONB containment: skill_ids @> '["<uuid>"]'::jsonb
        # cast() over a Python list is the most parameterizable form and
        # plays nicely with SQLAlchemy 2.x without raw text fragments.
        stmt = stmt.where(
            SkillUsageEvent.skill_ids.op("@>")(cast([str(skill_id)], JSONB))
        )

    if before is not None:
        # Cursor: split on the LAST ':' since ISO timestamps contain colons.
        try:
            sep_idx = before.rfind(":")
            if sep_idx <= 0:
                raise ValueError("missing separator")
            cursor_dt = datetime.fromisoformat(before[:sep_idx])
            cursor_id = uuid_lib.UUID(before[sep_idx + 1 :])
        except (ValueError, TypeError):
            raise api_error(
                422,
                "INVALID_CURSOR",
                "before must be '<created_at_iso>:<uuid>'",
            )
        stmt = stmt.where(
            or_(
                SkillUsageEvent.created_at < cursor_dt,
                and_(
                    SkillUsageEvent.created_at == cursor_dt,
                    SkillUsageEvent.id < cursor_id,
                ),
            )
        )

    stmt = stmt.limit(limit)
    return list(db.execute(stmt).scalars().all())
