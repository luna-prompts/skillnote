from datetime import date, timedelta, timezone, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db

router = APIRouter(prefix="/v1/analytics", tags=["analytics"])


def _date_filter_clause(days: int, alias: str = "created_at") -> str:
    if days > 0:
        return f"AND {alias} >= now() - interval '{days} days'"
    return ""


def _agent_filter_clause(agent: str | None, alias: str = "agent_name") -> str:
    if agent:
        return f"AND {alias} = :agent"
    return ""


def _collection_filter_clause(collection: str | None, alias: str = "collection_scope") -> str:
    if collection:
        return f"AND {alias} = :collection"
    return ""


def _build_params(days: int, agent: str | None, collection: str | None) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if days > 0:
        params["days"] = days
    if agent:
        params["agent"] = agent
    if collection:
        params["collection"] = collection
    return params


@router.get("/summary")
def get_summary(
    days: int = Query(default=7, ge=0),
    agent: str | None = Query(default=None),
    collection: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    date_clause = _date_filter_clause(days)
    agent_clause = _agent_filter_clause(agent)
    coll_clause = _collection_filter_clause(collection)
    params = _build_params(days, agent, collection)

    total_row = db.execute(
        text(f"""
            SELECT COUNT(*) AS total_calls,
                   COUNT(DISTINCT skill_slug) AS unique_skills,
                   COUNT(DISTINCT agent_name) AS unique_agents
            FROM skill_call_events
            WHERE 1=1
            {date_clause}
            {agent_clause}
            {coll_clause}
        """),
        params,
    ).mappings().one()

    today_params = dict(params)
    today_row = db.execute(
        text(f"""
            SELECT COUNT(*) AS calls_today
            FROM skill_call_events
            WHERE created_at >= now() - interval '1 days'
            {agent_clause}
            {coll_clause}
        """),
        today_params,
    ).mappings().one()

    most_called_row = db.execute(
        text(f"""
            SELECT skill_slug
            FROM skill_call_events
            WHERE skill_slug IS NOT NULL
            {date_clause}
            {agent_clause}
            {coll_clause}
            GROUP BY skill_slug
            ORDER BY COUNT(*) DESC
            LIMIT 1
        """),
        params,
    ).mappings().first()

    return {
        "total_calls": total_row["total_calls"],
        "unique_skills": total_row["unique_skills"],
        "unique_agents": total_row["unique_agents"],
        "calls_today": today_row["calls_today"],
        "most_called_skill": most_called_row["skill_slug"] if most_called_row else None,
    }


@router.get("/skill-calls")
def get_skill_calls(
    days: int = Query(default=7, ge=0),
    agent: str | None = Query(default=None),
    collection: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    date_clause = _date_filter_clause(days)
    agent_clause = _agent_filter_clause(agent)
    coll_clause = _collection_filter_clause(collection)
    params = _build_params(days, agent, collection)

    rows = db.execute(
        text(f"""
            SELECT skill_slug AS slug,
                   COUNT(*) AS call_count,
                   MAX(created_at) AS last_called_at
            FROM skill_call_events
            WHERE skill_slug IS NOT NULL
            {date_clause}
            {agent_clause}
            {coll_clause}
            GROUP BY skill_slug
            ORDER BY call_count DESC
        """),
        params,
    ).mappings().all()

    return [
        {
            "slug": row["slug"],
            "call_count": row["call_count"],
            "last_called_at": row["last_called_at"].isoformat() if row["last_called_at"] else None,
        }
        for row in rows
    ]


@router.get("/agents")
def get_agents(
    days: int = Query(default=7, ge=0),
    agent: str | None = Query(default=None),
    collection: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    date_clause = _date_filter_clause(days)
    agent_clause = _agent_filter_clause(agent)
    coll_clause = _collection_filter_clause(collection)
    params = _build_params(days, agent, collection)

    rows = db.execute(
        text(f"""
            SELECT agent_name,
                   COUNT(*) AS call_count
            FROM skill_call_events
            WHERE 1=1
            {date_clause}
            {agent_clause}
            {coll_clause}
            GROUP BY agent_name
            ORDER BY call_count DESC
        """),
        params,
    ).mappings().all()

    total = sum(row["call_count"] for row in rows)

    return [
        {
            "agent_name": row["agent_name"],
            "call_count": row["call_count"],
            "pct": round((row["call_count"] / total * 100), 2) if total > 0 else 0.0,
        }
        for row in rows
    ]


@router.get("/timeline")
def get_timeline(
    days: int = Query(default=7, ge=1),
    agent: str | None = Query(default=None),
    collection: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    agent_clause = _agent_filter_clause(agent)
    coll_clause = _collection_filter_clause(collection)
    params = _build_params(days, agent, collection)

    rows = db.execute(
        text(f"""
            SELECT DATE(created_at AT TIME ZONE 'UTC') AS day,
                   COUNT(*) AS call_count
            FROM skill_call_events
            WHERE created_at >= now() - interval '{days} days'
            {agent_clause}
            {coll_clause}
            GROUP BY day
        """),
        params,
    ).mappings().all()

    counts_by_date: dict[date, int] = {row["day"]: row["call_count"] for row in rows}

    today = datetime.now(timezone.utc).date()
    result = []
    for offset in range(days - 1, -1, -1):
        d = today - timedelta(days=offset)
        result.append({
            "date": d.isoformat(),
            "call_count": counts_by_date.get(d, 0),
        })

    return result


@router.get("/ratings")
def get_ratings(
    db: Session = Depends(get_db),
):
    """Aggregate ratings for all skills."""
    rows = db.execute(
        text("""
            SELECT skill_slug AS slug,
                   ROUND(AVG(rating)::numeric, 1) AS avg_rating,
                   COUNT(*) AS rating_count
            FROM skill_ratings
            GROUP BY skill_slug
            ORDER BY avg_rating DESC
        """),
    ).mappings().all()

    return [
        {
            "slug": row["slug"],
            "avg_rating": float(row["avg_rating"]),
            "rating_count": row["rating_count"],
        }
        for row in rows
    ]


@router.get("/ratings/{skill_slug}")
def get_rating_detail(
    skill_slug: str,
    db: Session = Depends(get_db),
):
    """Per-version rating breakdown for a single skill."""
    overall = db.execute(
        text("""
            SELECT ROUND(AVG(rating)::numeric, 1) AS avg_rating,
                   COUNT(*) AS rating_count
            FROM skill_ratings
            WHERE skill_slug = :slug
        """),
        {"slug": skill_slug},
    ).mappings().one()

    versions = db.execute(
        text("""
            SELECT skill_version AS version,
                   ROUND(AVG(rating)::numeric, 1) AS avg_rating,
                   COUNT(*) AS rating_count
            FROM skill_ratings
            WHERE skill_slug = :slug
            GROUP BY skill_version
            ORDER BY skill_version DESC
        """),
        {"slug": skill_slug},
    ).mappings().all()

    return {
        "slug": skill_slug,
        "avg_rating": float(overall["avg_rating"]) if overall["avg_rating"] else None,
        "rating_count": overall["rating_count"],
        "versions": [
            {
                "version": v["version"],
                "avg_rating": float(v["avg_rating"]),
                "rating_count": v["rating_count"],
            }
            for v in versions
        ],
    }


@router.get("/top-skills")
def get_top_skills(
    days: int = Query(default=30, ge=0),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Top skills ranked by a composite score: calls + rating quality.

    Returns call count, avg rating, rating count, and completion rate
    (how often agents rate after using a skill).
    """
    date_clause = _date_filter_clause(days, alias="e.created_at")

    rows = db.execute(
        text(f"""
            WITH calls AS (
                SELECT skill_slug AS slug,
                       COUNT(*) AS call_count,
                       MAX(created_at) AS last_called_at
                FROM skill_call_events
                WHERE skill_slug IS NOT NULL
                {date_clause}
                GROUP BY skill_slug
            ),
            ratings AS (
                SELECT skill_slug AS slug,
                       ROUND(AVG(rating)::numeric, 1) AS avg_rating,
                       COUNT(*) AS rating_count
                FROM skill_ratings
                WHERE 1=1
                {_date_filter_clause(days, alias="created_at")}
                GROUP BY skill_slug
            )
            SELECT c.slug,
                   c.call_count,
                   c.last_called_at,
                   COALESCE(r.avg_rating, 0) AS avg_rating,
                   COALESCE(r.rating_count, 0) AS rating_count,
                   CASE WHEN c.call_count > 0
                        THEN ROUND(COALESCE(r.rating_count, 0)::numeric / c.call_count * 100, 1)
                        ELSE 0 END AS completion_rate
            FROM calls c
            LEFT JOIN ratings r ON c.slug = r.slug
            ORDER BY c.call_count DESC, COALESCE(r.avg_rating, 0) DESC
            LIMIT :limit
        """),
        {**_build_params(days, None, None), "limit": limit},
    ).mappings().all()

    return [
        {
            "slug": row["slug"],
            "call_count": row["call_count"],
            "last_called_at": row["last_called_at"].isoformat() if row["last_called_at"] else None,
            "avg_rating": float(row["avg_rating"]) if row["avg_rating"] else None,
            "rating_count": row["rating_count"],
            "completion_rate": float(row["completion_rate"]),
        }
        for row in rows
    ]


@router.get("/rating-summary")
def get_rating_summary(
    days: int = Query(default=30, ge=0),
    db: Session = Depends(get_db),
):
    """Overall rating stats across all skills."""
    date_clause = _date_filter_clause(days)

    row = db.execute(
        text(f"""
            SELECT COUNT(*) AS total_ratings,
                   ROUND(AVG(rating)::numeric, 1) AS overall_avg,
                   COUNT(DISTINCT skill_slug) AS rated_skills,
                   COUNT(DISTINCT agent_name) FILTER (WHERE agent_name != '') AS rating_agents
            FROM skill_ratings
            WHERE 1=1
            {date_clause}
        """),
        _build_params(days, None, None),
    ).mappings().one()

    # Rating distribution (1-5)
    dist_rows = db.execute(
        text(f"""
            SELECT rating, COUNT(*) AS count
            FROM skill_ratings
            WHERE 1=1
            {date_clause}
            GROUP BY rating
            ORDER BY rating
        """),
        _build_params(days, None, None),
    ).mappings().all()

    distribution = {r: 0 for r in range(1, 6)}
    for dr in dist_rows:
        distribution[dr["rating"]] = dr["count"]

    return {
        "total_ratings": row["total_ratings"],
        "overall_avg": float(row["overall_avg"]) if row["overall_avg"] else None,
        "rated_skills": row["rated_skills"],
        "rating_agents": row["rating_agents"],
        "distribution": distribution,
    }


@router.get("/ratings/{skill_slug}/reviews")
def get_skill_reviews(
    skill_slug: str,
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Individual rating reviews for a skill, newest first."""
    rows = db.execute(
        text("""
            SELECT id, rating, outcome, agent_name, skill_version, session_id, created_at
            FROM skill_ratings
            WHERE skill_slug = :slug
            ORDER BY created_at DESC
            LIMIT :limit
        """),
        {"slug": skill_slug, "limit": limit},
    ).mappings().all()

    return [
        {
            "id": str(row["id"]),
            "rating": row["rating"],
            "outcome": row["outcome"],
            "agent_name": row["agent_name"] or "unknown",
            "skill_version": row["skill_version"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        }
        for row in rows
    ]


@router.get("/collections")
def get_collections(
    days: int = Query(default=7, ge=0),
    agent: str | None = Query(default=None),
    collection: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    date_clause = _date_filter_clause(days)
    agent_clause = _agent_filter_clause(agent)
    coll_clause = _collection_filter_clause(collection)
    params = _build_params(days, agent, collection)

    rows = db.execute(
        text(f"""
            SELECT collection_scope AS scope,
                   COUNT(*) AS call_count
            FROM skill_call_events
            WHERE 1=1
            {date_clause}
            {agent_clause}
            {coll_clause}
            GROUP BY collection_scope
            ORDER BY call_count DESC
        """),
        params,
    ).mappings().all()

    return [
        {
            "scope": row["scope"],
            "call_count": row["call_count"],
        }
        for row in rows
    ]
