"""OpenClaw integration endpoints.

Provides the /v1/openclaw/context-bundle endpoint that ranks skills against a
task summary using pgvector cosine distance and pre-aggregates supporting
metadata (usage counts, ratings, latest comment, deprecation flag) in a
constant number of queries regardless of the result-set size.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.core.errors import api_error
from app.db.models import Collection, Comment, Skill, SkillUsageEvent
from app.db.session import get_db
from app.schemas.openclaw import (
    ContextBundleCollection,
    ContextBundleRequest,
    ContextBundleResponse,
    ContextBundleSkill,
)
from app.services import embedding_service

router = APIRouter(prefix="/v1/openclaw", tags=["openclaw"])


@router.post("/context-bundle", response_model=ContextBundleResponse)
def context_bundle(
    req: ContextBundleRequest,
    db: Session = Depends(get_db),
) -> ContextBundleResponse:
    """Rank skills by semantic similarity to req.task_summary and return a
    bundle of metadata an agent can use to choose which skills to apply.

    Skills with NULL embedding are excluded from the ranking — that's
    deliberate so unbackfilled skills get noticed and re-embedded.
    """
    # 1. Embedding guard — fail fast if no provider key.
    if not embedding_service.is_configured():
        raise api_error(
            503,
            "EMBEDDING_NOT_CONFIGURED",
            "SkillNote is missing SKILLNOTE_EMBEDDING_API_KEY; cannot rank skills semantically",
        )

    # 2. Embed the task_summary. Provider failures bubble up as 502.
    #    Defense-in-depth: even with the is_configured() guard above, a race
    #    (settings reload, key revoked mid-flight) could surface
    #    EmbeddingNotConfigured here — map it to the same 503 envelope.
    try:
        query_vec = embedding_service.embed_text(req.task_summary)
    except embedding_service.EmbeddingNotConfigured:
        raise api_error(
            503,
            "EMBEDDING_NOT_CONFIGURED",
            "SkillNote is missing SKILLNOTE_EMBEDDING_API_KEY; cannot rank skills semantically",
        )
    except embedding_service.EmbeddingError as e:
        raise api_error(502, "EMBEDDING_PROVIDER_ERROR", str(e))

    # 3. Single ranked skill query via pgvector cosine distance.
    #    NULL-embedding skills are intentionally excluded — see module docstring.
    ranked_stmt = (
        select(Skill, Skill.embedding.cosine_distance(query_vec).label("dist"))
        .where(Skill.embedding.is_not(None))
        .order_by("dist")
        .limit(req.max_skills)
    )
    rows = db.execute(ranked_stmt).all()
    ranked_skills: list[Skill] = [row[0] for row in rows]

    # 4. Early-return when no skills match. We still pull collections — an
    #    empty skills list doesn't mean an empty registry of collections.
    if not ranked_skills:
        bundle_collections = [
            ContextBundleCollection(name=c.name, description=c.description)
            for c in db.query(Collection).all()
        ]
        return ContextBundleResponse(collections=bundle_collections, skills=[])

    # 5. Pull all collections — small set, no ranking needed.
    collections = db.query(Collection).all()

    skill_id_uuids = [s.id for s in ranked_skills]
    skill_id_strs = [str(s.id) for s in ranked_skills]

    # 6. Pre-aggregate usage_count_30d in ONE query via JSONB array unnesting.
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

    # 7. Pre-aggregate rating_avg in ONE query.
    rating_stmt = (
        select(Comment.skill_id, func.avg(Comment.rating).label("avg"))
        .where(Comment.skill_id.in_(skill_id_uuids))
        .where(Comment.rating.is_not(None))
        .group_by(Comment.skill_id)
    )
    rating_avgs: dict[uuid.UUID, float] = {
        row.skill_id: float(row.avg) for row in db.execute(rating_stmt).all()
    }

    # 8. Pre-aggregate latest comment per skill via DISTINCT ON.
    latest_stmt = (
        select(Comment.skill_id, Comment.body)
        .where(Comment.skill_id.in_(skill_id_uuids))
        .order_by(Comment.skill_id, desc(Comment.created_at))
        .distinct(Comment.skill_id)
    )
    latest_comments: dict[uuid.UUID, str] = {
        row.skill_id: row.body[:200] for row in db.execute(latest_stmt).all()
    }

    # 9. Pre-aggregate deprecation flag in ONE query.
    dep_stmt = (
        select(Comment.skill_id)
        .where(Comment.skill_id.in_(skill_id_uuids))
        .where(Comment.comment_type == "agent_deprecation_warning")
        .distinct()
    )
    deprecated: set[uuid.UUID] = {row.skill_id for row in db.execute(dep_stmt).all()}

    # 10. Build the response payload.
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
