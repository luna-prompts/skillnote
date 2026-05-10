# SkillNote × OpenClaw — v2 Foundation Plan

> **Spec source:** `skillnote_openclaw_living_skill_system_prd.md`
> **Constraints source:** `docs/superpowers/plans/2026-04-26-skillnote-openclaw-asks.md`
> **Replaces:** `docs/superpowers/plans/2026-04-26-skillnote-openclaw-v1.md` (parked, reference only)
> **Scope cut:** This plan covers PRD Milestones 1+2 only (Foundation + Resolver Contract). Milestones 3–5 (Activity UI, Agent Suggestions, Skill Garden) are deferred to v2.1 — they need this foundation to exist first.

## Goal

Ship the smallest end-to-end integration that proves the PRD's central thesis: **OpenClaw spawns a Skill Resolver subagent, the resolver queries SkillNote for the skill universe, and OpenClaw uses what it returns.** The user sees zero UI surface in v2 — they see their agent picking and using SkillNote skills autonomously and usage events landing in the database. v2.1 adds the human-facing UI on top.

## Architecture

```
[SkillNote web UI: Settings → OpenClaw]
       │  generates one-line install
       ▼
[user runs:  curl -sf http://<host>:8082/setup/openclaw | bash]
       │  drops 2 skills + config into ~/.openclaw/skills/
       ▼
[OpenClaw session start]
       │  loads skillnote-awareness (always-injected meta-skill)
       ▼
[user message: "Help me draft a refund reply"]
       │  awareness skill teaches: spawn skillnote-resolver subagent
       ▼
[skillnote-resolver subagent]
       │  POST /v1/openclaw/context-bundle  → skill universe
       │  returns structured JSON: collection, skills, confidence, risk
       ▼
[main agent executes task using selected skills]
       │  POST /v1/openclaw/usage  → log usage event
       │  POST /v1/skills/<slug>/comments  (author_type=agent) when reflecting
       ▼
[skill_usage_events + comments rows in postgres]
```

## Tech Stack

Backend FastAPI + SQLAlchemy 2 + Alembic; one new migration (0015), one new model, one extended model, two new endpoints in a new `openclaw.py` router, comments endpoint extended with new fields. Frontend Next.js 16 settings card under `/settings`. Skill bundle is two markdown files + a JSON config template, served via existing `/v1/plugin.zip` pattern adapted to OpenClaw.

## Release

Single PR against master, version bump `0.3.4 → 0.4.0` (minor — new public surface). Behind no flag (additive, opt-in via the install command).

## Owner

Atharva (single-owner solo build, gstack methodology).

---

## Design Decisions (Locked)

| # | Decision | Source |
|---|---|---|
| DD1 | Two-skill bundle: `skillnote-awareness` (always-injected meta) + `skillnote-resolver` (subagent invoked by name). Not one inline skill. | asks.md D1 |
| DD2 | One new table: `skill_usage_events`. Comments table extended with `author_type`/`comment_type`/`rating`/`linked_usage_id`. No `skill_drafts`, no `marketplace_candidates` tables in v2. | asks.md D2 |
| DD3 | CLI is orphaned (verified 2026-04-26: no reference from `install.sh`, root `package.json`, `.github/`, Dockerfiles, plugin, or `setup.py`). v2 does NOT touch `cli/`. Whole-CLI deprecation tracked separately. The PRD bash installer is the only install path for OpenClaw — no CLI surface to retire because no CLI surface is wired up. | asks.md D3 + install.sh audit |
| DD4 | No auth, no JWT, no hosted free tier. SkillNote is self-hosted; install command is generated from the user's own SkillNote UI with their host baked in. | PRD §8.1, §8.2; asks.md R7, R8 |
| DD5 | Resolver returns structured JSON per PRD §15. Backend does NOT decide skills — it only ships the universe. | PRD §9.3 |
| DD6 | Reuse existing `comments` table for agent reflections (`author_type='agent'`). No `skill_reflections` table. | asks.md A3 |
| DD7 | Usage logging stores task summary only, never raw user messages. No opt-in raw storage in v2. | PRD §16.3 + my §16.3 pushback |
| DD8 | AGENTS.md graft requires one explicit confirmation at install. After that, drafts and comments need no confirmation; production skill mutation does (deferred to v2.1 with drafts table). | PRD §16.1 |
| DD9 | Endpoint shapes: extend existing `/v1/skills/{slug}/comments`, do NOT add `/v1/api/skills/...` parallel namespace. New endpoints live under `/v1/openclaw/*`. | Existing routing convention |
| DD10 | Awareness skill version pinning: skill body embeds `SKILLNOTE_AWARENESS_VERSION="1.0.0"` and the install bash overwrites if mismatch. Self-update on next install run. | Gap I flagged in PRD analysis |
| DD11 | Skill ranking in `context-bundle` is semantic via pgvector cosine similarity, not keyword overlap. Default embedding provider: OpenAI `text-embedding-3-small` (1536 dim). Pluggable via `SKILLNOTE_EMBEDDING_PROVIDER` env (openai \| voyage). Operator must set `SKILLNOTE_EMBEDDING_API_KEY` before upgrading to 0.4.0; otherwise context-bundle returns 503 `EMBEDDING_NOT_CONFIGURED` instead of degrading silently. | User direction: "fix it, no need to scope out" |

---

## File Structure

### Created

```
backend/alembic/versions/0015_openclaw_foundation.py        # pgvector ext + skill_usage_events + comments ext + skills.embedding
backend/app/db/models/skill_usage_event.py                  # new SQLAlchemy model
backend/app/api/openclaw.py                                 # POST /v1/openclaw/{context-bundle,usage}
backend/app/schemas/openclaw.py                             # Pydantic schemas for context bundle + usage
backend/app/services/embedding_service.py                   # provider abstraction (openai|voyage), embed_text()
backend/scripts/backfill_embeddings.py                      # one-shot: embed all existing skills
plugin-openclaw/skillnote-awareness/SKILL.md                # always-injected meta-skill
plugin-openclaw/skillnote-resolver/SKILL.md                 # subagent skill (resolver contract)
plugin-openclaw/config.template.json                        # local SkillNote config template
src/components/settings/openclaw-setup-card.tsx             # UI card with copy-install-command button
docs/openclaw-integration.md                                # user-facing doc, linked from settings card
```

### Modified

```
backend/app/db/models/skill.py                              # +embedding column (vector(1536), nullable)
backend/app/db/models/comment.py                            # +author_type, +comment_type, +rating, +linked_usage_id
backend/app/db/models/__init__.py                           # export SkillUsageEvent
backend/app/api/comments.py                                 # accept new fields on POST, return on GET
backend/app/api/skills.py                                   # generate embedding on create + on body/desc update
backend/app/schemas/comment.py                              # add new optional fields
backend/app/api/setup.py                                    # add /setup/openclaw endpoint, /v1/openclaw-bundle.zip
backend/app/core/config.py                                  # +embedding_provider, +embedding_api_key, +embedding_model
backend/app/main.py                                         # register openclaw_router + startup embedding-config check
backend/pyproject.toml                                      # +pgvector, +openai (or +voyageai), +numpy
src/app/(app)/settings/page.tsx                             # mount OpenClawSetupCard
package.json                                                # 0.3.4 → 0.4.0
CHANGELOG.md                                                # 0.4.0 entry (call out embedding env requirement)
```

### Not touched

```
cli/                                                        # orphaned tree (DD3); whole-CLI deprecation is a separate PR
```

---

## Tasks

### Task 1 — Migration 0015: pgvector + skill_usage_events + comments extension + skills.embedding

**Why first:** Every other backend task depends on these schema changes.

**Pre-step:** Add deps to `backend/pyproject.toml`: `pgvector>=0.3.0`, `openai>=1.40.0` (default provider), `numpy>=1.26` (vector ops). `pip install -e backend/` to refresh.

**Steps:**
1. `cd backend && alembic revision -m "openclaw_foundation"` → renames file to `0015_openclaw_foundation.py`.
2. In `upgrade()`:
   - `op.execute("CREATE EXTENSION IF NOT EXISTS vector")` — pgvector. Requires Postgres 16 with the `pgvector` package (already in `docker-compose.yml`'s postgres image? **VERIFY** — current image may be vanilla `postgres:16`. If so, swap to `pgvector/pgvector:pg16` in docker-compose.yml as part of this task.).
   - `op.add_column('skills', sa.Column('embedding', Vector(1536), nullable=True))` — `from pgvector.sqlalchemy import Vector`. Nullable because backfill is async (Task 4.5). Index it: `op.execute("CREATE INDEX ix_skills_embedding_hnsw ON skills USING hnsw (embedding vector_cosine_ops)")`. HNSW is faster than IVFFlat for our scale (<10k skills) and needs no tuning.
   - `op.create_table('skill_usage_events', ...)` with columns:
     - `id` UUID primary key
     - `agent_name` String(255) nullable=False (e.g., "openclaw-main")
     - `task_summary` Text nullable=False (model-generated paraphrase, max 2000 chars enforced in Pydantic)
     - `collection_id` TEXT nullable, FK to `collections.name` ON DELETE SET NULL — NOTE: Collections PK is `name` (Text), not a UUID. Verified against `backend/app/db/models/collection.py`.
     - `skill_ids` JSONB nullable=False, default=[] (list of skill UUIDs as strings)
     - `resolver_confidence` Float nullable=True (0.0–1.0)
     - `risk_level` String(32) nullable=True (low|medium|high)
     - `outcome` String(32) nullable=True (completed|failed|abandoned|unknown)
     - `channel` String(64) nullable=True (telegram|slack|cli|...)
     - `metadata_json` JSONB nullable=True (renamed from `metadata` — `metadata` is reserved on SQLAlchemy Base)
     - `created_at` DateTime(timezone=True) server_default=func.now() nullable=False
   - `op.create_index('ix_skill_usage_events_created_at', 'skill_usage_events', ['created_at'])`
   - `op.create_index('ix_skill_usage_events_collection_id', 'skill_usage_events', ['collection_id'])`
   - `op.add_column('comments', sa.Column('author_type', sa.String(16), nullable=False, server_default='human'))` — server_default makes the migration safe on existing rows; drop default afterward via `op.alter_column`.
   - `op.add_column('comments', sa.Column('comment_type', sa.String(64), nullable=True))` — values: human_comment | agent_observation | agent_issue | agent_patch_suggestion | agent_success_note | agent_deprecation_warning. Enum-as-string (no DB enum) for forward compatibility.
   - `op.add_column('comments', sa.Column('rating', sa.Integer, nullable=True))` — nullable, range 1–5 enforced in Pydantic.
   - `op.add_column('comments', sa.Column('linked_usage_id', UUID(as_uuid=True), nullable=True))`
   - `op.create_foreign_key('fk_comments_linked_usage_id', 'comments', 'skill_usage_events', ['linked_usage_id'], ['id'], ondelete='SET NULL')`
3. In `downgrade()`: drop FK, drop columns, drop indexes, drop table, drop `ix_skills_embedding_hnsw`, drop `skills.embedding`, `op.execute("DROP EXTENSION IF EXISTS vector")` — exact reverse order.
4. Verify: `alembic upgrade head && alembic downgrade -1 && alembic upgrade head` cleanly.

**Pitfall (carried from parked v1 review):** Do NOT use `func.case()` — `case` is a SQLAlchemy top-level construct: `from sqlalchemy import case`. Anywhere in this plan you see "compute X via case statement," it's `case((cond, val), else_=...)`, never `func.case`.

**Pitfall (pgvector):** Test with the actual postgres image you ship with. The vanilla `postgres:16` image does NOT include pgvector — it must be `pgvector/pgvector:pg16` or the extension is unavailable and `CREATE EXTENSION` fails. Update `docker-compose.yml` AND any Dockerfile that pins postgres.

**Commit:** `feat(backend): add pgvector, skill_usage_events, comments extension, skills.embedding`

---

### Task 2 — Models: SkillUsageEvent + Comment extension + Skill.embedding

**Steps:**
1. Create `backend/app/db/models/skill_usage_event.py` mirroring the migration columns. Use `Mapped[uuid.UUID]`, `mapped_column(JSONB, nullable=False, default=list)` for `skill_ids`. Add `__tablename__ = "skill_usage_events"`.
2. Add `relationship` to `Collection` model: `usage_events = relationship("SkillUsageEvent", back_populates="collection")` and reciprocal on `SkillUsageEvent`.
3. Edit `backend/app/db/models/comment.py`: add `author_type`, `comment_type`, `rating`, `linked_usage_id` mapped columns. Default `author_type` to `"human"` in the Python default (alongside server_default in migration).
4. Edit `backend/app/db/models/skill.py`: add `embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)`. Import `from pgvector.sqlalchemy import Vector`. Don't include in default `__repr__` — 1536 floats spam logs.
5. Edit `backend/app/db/models/__init__.py`: import and export `SkillUsageEvent`.

**Verification:** `cd backend && python -c "from app.db.models import SkillUsageEvent, Skill; print(SkillUsageEvent.__table__.columns.keys()); print('embedding' in Skill.__table__.columns)"` lists all expected columns and confirms `embedding` exists on Skill.

**Commit:** `feat(backend): add SkillUsageEvent model + extend Comment + add Skill.embedding`

---

### Task 2.5 — Embedding service + provider abstraction

**Why this task exists:** Embeddings need a single chokepoint so we can swap providers and mock in tests.

**Steps:**
1. Edit `backend/app/core/config.py` (`Settings` class):
   - Add `embedding_provider: Literal["openai", "voyage"] = "openai"` (env: `SKILLNOTE_EMBEDDING_PROVIDER`).
   - Add `embedding_api_key: str | None = None` (env: `SKILLNOTE_EMBEDDING_API_KEY`).
   - Add `embedding_model: str = "text-embedding-3-small"` (env: `SKILLNOTE_EMBEDDING_MODEL`).
   - Add `embedding_dim: int = 1536` (env: `SKILLNOTE_EMBEDDING_DIM`). Must match the migration's `Vector(1536)` — startup check enforces equality.
2. Create `backend/app/services/embedding_service.py`:
   - `class EmbeddingNotConfigured(Exception): pass`
   - `def is_configured() -> bool` — returns `bool(settings.embedding_api_key)`.
   - `def embed_text(text: str) -> list[float]` — single string → vector.
   - `def embed_batch(texts: list[str]) -> list[list[float]]` — batch path for backfill (OpenAI accepts up to 2048 inputs per call; chunk if needed).
   - Provider dispatch: `if settings.embedding_provider == "openai": ...` calls `openai.Client(api_key=...).embeddings.create(model=..., input=texts)`. Voyage analog using `voyageai` SDK.
   - Caller-friendly errors: catch provider HTTP errors and raise `EmbeddingNotConfigured` (missing key) or `EmbeddingError` (rate-limited / network) — handlers convert to 503/429.
   - **Caching:** add a small LRU on `embed_text` keyed by SHA256 of input (via `functools.lru_cache(maxsize=1024)`). Cuts cost on repeated `task_summary`s in test loops.
3. Edit `backend/app/main.py`: add a startup event that logs `WARNING: SKILLNOTE_EMBEDDING_API_KEY is not set; /v1/openclaw/context-bundle will return 503` if `embedding_service.is_configured() is False`. Don't crash — operators may upgrade in two steps.
4. Build content for embedding: function `_skill_embedding_text(skill: Skill) -> str` returns `f"{skill.name}\n\n{skill.description or ''}"`. Body is excluded — too long, dilutes signal (DD11 implication).

**Tests:** `backend/tests/unit/test_embedding_service.py`:
- Configured + valid input → returns 1536-element list of floats.
- Not configured → raises `EmbeddingNotConfigured`.
- Batch of 5 strings → returns 5 vectors in input order.
- LRU cache hit on second identical call (assert provider called once).
- Tests use `monkeypatch` to stub the OpenAI client; CI does NOT call the real API.

**Commit:** `feat(backend): add embedding service with openai provider and LRU cache`

---

### Task 3 — Pydantic schemas

**Steps:**
1. Create `backend/app/schemas/openclaw.py`:
   - `ContextBundleRequest`: `task_summary: str = Field(max_length=2000)`, `channel: str | None`, `workspace: str | None`, `recent_skill_ids: list[uuid.UUID] = []`, `max_skills: int = Field(default=20, ge=1, le=100)`.
   - `ContextBundleSkill`: `id`, `slug`, `name`, `collections: list[str]` (Skill.collections is ARRAY(Text); skills belong to MANY collections), `description`, `rating_avg: float | None`, `usage_count_30d: int`, `staleness_status: str | None`, `recent_comments_summary: str | None`.
   - `ContextBundleCollection`: `name` (PK), `description`. (No `id`/`slug` — Collections schema uses `name` Text PK.)
   - `ContextBundleResponse`: `collections: list[ContextBundleCollection]`, `skills: list[ContextBundleSkill]`.
   - `UsageEventCreate`: mirror SkillUsageEvent columns minus id/created_at. Validate `risk_level in {low, medium, high}`, `outcome in {completed, failed, abandoned, unknown}`, `resolver_confidence` between 0 and 1.
   - `UsageEventOut`: full model representation.
2. Edit `backend/app/schemas/comment.py`:
   - Add to `CommentCreate`: `author_type: Literal["human", "agent"] = "human"`, `comment_type: str | None = None`, `rating: int | None = Field(default=None, ge=1, le=5)`, `linked_usage_id: uuid.UUID | None = None`.
   - Add same fields to `CommentOut`.
   - Validator: `if author_type == "agent" and not comment_type: raise ValueError("agent comments require comment_type")`.

**Verification:** `pytest backend/tests/unit -k schema` passes.

**Commit:** `feat(backend): add openclaw schemas + extend comment schemas with author_type/rating`

---

### Task 4 — `/v1/openclaw/context-bundle` endpoint

**Why this is the heart of the integration:** This is what the resolver subagent calls. Get this wrong and the whole product feels broken.

**Steps:**
1. Create `backend/app/api/openclaw.py` with `router = APIRouter(prefix="/v1/openclaw", tags=["openclaw"])`.
2. `POST /context-bundle` handler:
   - Guard: `if not embedding_service.is_configured(): raise api_error(503, "EMBEDDING_NOT_CONFIGURED", "SkillNote is missing SKILLNOTE_EMBEDDING_API_KEY...")` (DD11).
   - Embed `task_summary` once: `query_vec = embedding_service.embed_text(task_summary)`. Catch `EmbeddingError` → 502 `EMBEDDING_PROVIDER_ERROR`.
   - **Single ranked query** (semantic + soft-delete filter + non-null embedding) using pgvector cosine distance:
     ```python
     stmt = (
         select(Skill, Skill.embedding.cosine_distance(query_vec).label("dist"))
         .where(Skill.embedding.is_not(None))
         .order_by("dist")
         .limit(max_skills)
     )
     ```
     This is the WHOLE ranking — no keyword fallback, no recency boost in v2. Cosine on `name+description` embedding is the spec.
   - Pull all collections (`db.query(Collection).all()`) — small, no ranking needed.
   - For the returned ≤max_skills skills, compute `usage_count_30d` in ONE query: `select(skill_id, count(*)) from skill_usage_events where created_at > now()-'30d' and skill_id = ANY(:ids) group by skill_id`. Use `func.jsonb_array_elements_text(SkillUsageEvent.skill_ids)` lateral join to expand the JSONB array back to rows. Pre-aggregate into dict.
   - `rating_avg` in ONE query: `select(skill_id, avg(rating)) from comments where rating is not null and skill_id = ANY(:ids) group by skill_id`. Pre-aggregate.
   - Latest comment summary in ONE query using `DISTINCT ON (skill_id)` ordered by created_at desc. Trim to 200 chars. Pre-aggregate.
   - `staleness_status`: rule — `"needs_review"` if (a) any comment with `comment_type='agent_deprecation_warning'` exists OR (b) `rating_avg < 3.0`; else `"healthy"`. Computed from the dicts already loaded.
   - Build response in the order the ranked query returned. Return `ContextBundleResponse`.
3. Total endpoint budget: must complete in <600ms for 1000-skill registry (embedding API call ~100ms + pgvector ANN ~10ms + 4 aggregation queries ~50ms total). If embed_text dominates, the LRU cache amortizes over duplicate task summaries in tests.
4. **Skills with NULL embedding are excluded.** This is a deliberate signal: until backfill (Task 4.5) runs, only embedded skills surface. After backfill they all surface. Document in the awareness skill (Task 8) so the agent doesn't silently miss skills.

**Pitfall (carried from parked v1 review):** Do not write `Comment.author.in_([]) if [] else False` — that's mixing a Python literal with a SQL expression. Use `or_(*[Comment.comment_type == t for t in agent_types]) if agent_types else literal(False)`, or simpler: skip the filter entirely when the list is empty.

**Tests:** `backend/tests/integration/test_openclaw_context_bundle.py`:
- Embedding service not configured → 503 `EMBEDDING_NOT_CONFIGURED` (assert error code, not just status).
- Empty registry → returns empty arrays.
- 5 skills with embeddings + 1 collection + monkeypatched `embed_text` returning fixed query vec → ranked deterministically by cosine.
- Skill with NULL embedding present → excluded from response.
- Skill with 3 agent_issue comments at rating 2 → `staleness_status = "needs_review"`.
- Embedding-similar skill (same name as `task_summary`) ranked first.
- `max_skills=2` → exactly 2 skills returned.
- N+1 sentinel: assert query count ≤ 5 (1 ranked + 1 collections + 3 aggregation) regardless of skill count (use `sqlalchemy.event` listener).
- Embedding provider raises → 502 `EMBEDDING_PROVIDER_ERROR`.

**Commit:** `feat(backend): add POST /v1/openclaw/context-bundle with pgvector cosine ranking`

---

### Task 4.5 — Wire embeddings into skill create/update + backfill existing skills

**Why this exists:** Task 4 reads embeddings; this task generates them. Without this, the new column stays NULL forever and context-bundle returns nothing.

**Steps:**
1. Edit `backend/app/api/skills.py`:
   - On `POST /v1/skills` (create): after the skill row is built but before commit, call `skill.embedding = embedding_service.embed_text(_skill_embedding_text(skill))`. Wrap in try/except `EmbeddingNotConfigured` — log warning and proceed with `embedding=None` (so create still works without an API key; the skill just won't surface in context-bundle until backfilled).
   - On `PATCH /v1/skills/{slug}` (update): if `name` or `description` changed (compare before/after), regenerate embedding the same way. Body changes do NOT trigger re-embedding (DD11: body excluded from embedding text).
   - On `POST /v1/skills/{slug}/restore` (version restore, if it exists): treat like update — re-embed if name/description differ from current.
2. Create `backend/scripts/backfill_embeddings.py`:
   - Argparse: `--batch-size 100`, `--dry-run`, `--only-missing` (default true; `--all` re-embeds everything for model swaps).
   - Stream skills WHERE `embedding IS NULL` (or all when `--all`), batch into groups of `--batch-size`.
   - Call `embedding_service.embed_batch([_skill_embedding_text(s) for s in batch])`.
   - Bulk-update via `db.bulk_update_mappings(Skill, [{"id": s.id, "embedding": vec} for s, vec in zip(batch, vecs)])`.
   - Print progress every batch.
   - Refuse to run if `embedding_service.is_configured()` is False (clear error message: "set SKILLNOTE_EMBEDDING_API_KEY first").
3. Wire into Docker entrypoint: `backend/scripts/wait_for_db.py → alembic upgrade head → seed_data.py → backfill_embeddings.py --only-missing → uvicorn`. Backfill is idempotent (only-missing); safe to run on every container start.
4. Document in CHANGELOG (Task 7) and `docs/openclaw-integration.md` (Task 12): "Upgrading from <0.4.0 requires `SKILLNOTE_EMBEDDING_API_KEY` env var. Existing skills are auto-backfilled on first container start after upgrade."

**Tests:** `backend/tests/integration/test_embedding_backfill.py`:
- Backfill with 3 NULL-embedding skills + monkeypatched embed_batch → all 3 get embeddings.
- Backfill with `--only-missing` and 2 already-embedded skills → only the missing one is processed (assert embed_batch called once with size 1).
- Backfill without API key → exits with non-zero code.
- Skill create endpoint with embedding service stubbed → skill row has embedding populated.
- Skill update changing only body → embedding NOT regenerated (assert embed_text not called).
- Skill update changing description → embedding regenerated.

**Commit:** `feat(backend): generate skill embeddings on create/update + backfill script`

---

### Task 5 — `/v1/openclaw/usage` endpoint

**Steps:**
1. Same router. `POST /usage` handler:
   - Validate `UsageEventCreate`.
   - Validate `task_summary` does not look like a raw user message (>1000 chars triggers a 422 with helpful message — agents should summarize, not dump). Soft check, not perfect, but the contract is clear.
   - Validate every UUID in `skill_ids` exists in `skills` table. Reject 422 if any unknown.
   - Insert row, return `UsageEventOut`.
2. `GET /usage?limit=50&skill_id=<uuid>&since=<iso8601>` for v2.1 UI consumption — include now since it's trivial and the resolver may want history. Pagination via `limit` + `before` cursor (created_at + id tiebreak). Default ORDER BY created_at DESC.

**Tests:**
- POST valid event → 201 + body matches.
- POST with unknown skill_id → 422.
- POST with task_summary > 1000 chars → 422.
- POST with `risk_level="extreme"` → 422.
- GET with `since` filter → only events after timestamp.

**Commit:** `feat(backend): add POST/GET /v1/openclaw/usage endpoints`

---

### Task 6 — Extend `/v1/skills/{slug}/comments` for agent comments

**Steps:**
1. Edit `backend/app/api/comments.py`:
   - Update `create_comment` to accept and persist `author_type`, `comment_type`, `rating`, `linked_usage_id`.
   - If `linked_usage_id` is provided, validate it exists in `skill_usage_events` (404 with code `LINKED_USAGE_NOT_FOUND` if missing).
   - When `author_type='agent'`, require `comment_type` (already enforced in schema validator from Task 3, but defense in depth in the handler).
   - Update `list_comments` response and `update_comment` to handle the new fields.
2. **Backwards compatibility:** Existing clients sending only `author` + `body` continue to work (`author_type` defaults to `"human"`, other fields default to `None`).

**Tests** (extend `backend/tests/integration/test_comments.py` if exists, else create):
- POST agent comment without `comment_type` → 422.
- POST agent comment with valid `comment_type='agent_observation'` and `rating=4` → 201, fields persisted.
- POST with `linked_usage_id=<uuid that doesn't exist>` → 404.
- GET returns new fields on agent comments and nulls on legacy human comments.
- Existing human comment POST with just `author` + `body` still works → 201.

**Commit:** `feat(backend): extend comments endpoint for agent reflections (author_type, rating, linked_usage)`

---

### Task 7 — Register openclaw router + version bump

**Steps:**
1. Edit `backend/app/main.py`:
   - Add `from app.api.openclaw import router as openclaw_router`.
   - Add `app.include_router(openclaw_router)` near other includes.
2. Edit `package.json`: `"version": "0.3.4"` → `"version": "0.4.0"`.
3. Add CHANGELOG.md entry under new `## 0.4.0 — 2026-04-26`:
   - Added: SkillNote × OpenClaw foundation. New `/v1/openclaw/context-bundle` and `/v1/openclaw/usage` endpoints.
   - Added: pgvector-backed semantic skill ranking via `text-embedding-3-small`. **BREAKING for upgraders:** set `SKILLNOTE_EMBEDDING_API_KEY` (OpenAI) or `SKILLNOTE_EMBEDDING_PROVIDER=voyage` + `SKILLNOTE_EMBEDDING_API_KEY` (Voyage) before starting. First container start auto-backfills existing skills.
   - Added: `skill_usage_events` table and comments extension for agent reflections.
   - Added: `/setup/openclaw` install command, two-skill bundle (`skillnote-awareness` + `skillnote-resolver`).
   - Added: Settings → OpenClaw setup card.
   - Changed: `docker-compose.yml` postgres image bumped to `pgvector/pgvector:pg16`.

**Commit:** `chore(release): 0.4.0 — openclaw foundation`

---

### Task 8 — Author skillnote-awareness skill body

**Why this is hard:** The skill is the entire UX surface for the agent. Wording matters more than code.

**Steps:**
1. Create `plugin-openclaw/skillnote-awareness/SKILL.md` with:
   - YAML frontmatter:
     ```yaml
     ---
     name: skillnote-awareness
     description: SkillNote registry awareness — teaches when to consult SkillNote and how to spawn the resolver subagent. Always-injected meta-skill.
     metadata:
       openclaw:
         always: true
       skillnote_awareness_version: "1.0.0"
     ---
     ```
   - Body sections (tight; <12K chars per OpenClaw bootstrap cap):
     - **What is SkillNote?** One paragraph: registry of record for this user's skills. Lives at `{{HOST}}` (templated by install bash from the SkillNote host).
     - **When to consult SkillNote.** Trigger conditions: user asks task that may benefit from a skill; user names a domain ("customer support today"); user complains agent forgot a procedure. Anti-triggers: trivial chat, ack-only, file edits already in flight.
     - **How to consult.** Spawn the `skillnote-resolver` subagent (by skill name) with task summary + channel + workspace. Wait for structured JSON output. Use selected skills.
     - **How to log usage.** After acting, POST to `{{HOST}}/v1/openclaw/usage` with the skill IDs used + outcome + confidence the resolver returned. Summarize the task; do NOT include raw user message.
     - **How to reflect.** When you notice a skill helped/failed/seems stale, POST to `{{HOST}}/v1/skills/{slug}/comments` with `author_type=agent` and a `comment_type` from: agent_observation | agent_issue | agent_patch_suggestion | agent_success_note | agent_deprecation_warning. Optionally `rating` 1–5.
     - **When to ask the user.** Confidence < 0.6, two equally valid collections, marketplace clone candidate, dangerous skill permission. Default to silent action.
     - **Where the user sees this.** Tell them about the SkillNote web UI at `{{WEB_URL}}` only when they ask "how do I see what you've been doing" — do not push it.
2. Create `plugin-openclaw/config.template.json` (placeholder values, replaced by install bash):
   ```json
   {
     "skillnote_base_url": "{{HOST}}",
     "skillnote_web_url": "{{WEB_URL}}",
     "agent_name": "openclaw-main",
     "auto_resolve_skills": true,
     "write_reflections": true,
     "allow_draft_creation": false,
     "allow_auto_marketplace_install": false
   }
   ```
   `allow_draft_creation: false` because v2 has no drafts table — agent can only comment, not draft.

**Verification:** Manual review: read aloud, does it sound like an instruction *to the agent* and not marketing copy? Does it tell the agent what to do and what NOT to do? Does it stay under 12K chars?

**Commit:** `feat(openclaw): author skillnote-awareness meta-skill body`

---

### Task 9 — Author skillnote-resolver skill body

**Steps:**
1. Create `plugin-openclaw/skillnote-resolver/SKILL.md`:
   - YAML frontmatter:
     ```yaml
     ---
     name: skillnote-resolver
     description: Subagent that decides which SkillNote skills/collection are relevant for the current task. Returns structured JSON only.
     metadata:
       openclaw:
         subagent: true
     ---
     ```
   - Body must be a focused subagent prompt:
     - **Your one job.** Receive task context, query SkillNote, return structured JSON. Do not execute the task.
     - **Step 1.** POST `{{HOST}}/v1/openclaw/context-bundle` with the task summary you were given.
     - **Step 2.** Read the returned skills + collections + ratings + comments + usage. Penalize: `staleness_status="needs_review"`, `rating_avg<3.0`. Boost: high `usage_count_30d`, recent `agent_success_note` comments.
     - **Step 3.** Pick ONE collection (or none) and 1–5 skills (or none if no fit).
     - **Step 4.** Set `confidence` 0.0–1.0 honestly. Set `risk_level`: low (default) | medium (touches money/credentials/external messaging) | high (irreversible / production / legal).
     - **Step 5.** Set `needs_user_confirmation = true` if confidence < 0.6 OR risk_level >= medium.
     - **Step 6.** If no skill fits, set `missing_capability` to a one-line description of what's missing and `suggest_marketplace_search = true`.
     - **Output schema (return ONLY this JSON, no prose):** copy verbatim from PRD §15 output block.
     - **Hard rules:** Never install a skill. Never invoke a skill body. Never edit files. Never store raw user messages anywhere.

**Verification:** Re-read against PRD §15 — every field in the output spec is covered.

**Commit:** `feat(openclaw): author skillnote-resolver subagent skill`

---

### Task 10 — `/setup/openclaw` install endpoint + bundle ZIP

**Steps:**
1. Edit `backend/app/api/setup.py`:
   - Add `_OPENCLAW_DIR = Path("/openclaw") if Path("/openclaw").is_dir() else Path(__file__).resolve().parent.parent.parent.parent / "plugin-openclaw"`.
   - Add `GET /v1/openclaw-bundle.zip`: same pattern as `get_plugin_zip` — walk `plugin-openclaw/`, template `{{HOST}}` and `{{WEB_URL}}` in each file, return ZIP. Refuse symlink entries (existing security pattern).
   - Add `GET /setup/openclaw`: returns a bash script (templated like `_SETUP_SCRIPT` for Claude Code). The script:
     ```bash
     #!/bin/bash
     set -euo pipefail
     API_URL="__API_URL__"
     WEB_URL="__WEB_URL__"
     OPENCLAW_HOME="$HOME/.openclaw"
     SKILLS_DIR="$OPENCLAW_HOME/skills"
     # prereqs
     command -v curl >/dev/null || { echo "curl required"; exit 1; }
     command -v unzip >/dev/null || { echo "unzip required"; exit 1; }
     # explicit consent (DD8) — one-time graft
     echo "SkillNote: this will install 2 skills into $SKILLS_DIR/"
     echo "  - skillnote-awareness  (always-injected meta-skill)"
     echo "  - skillnote-resolver   (subagent invoked by name)"
     echo "and write config to $OPENCLAW_HOME/skillnote/config.json"
     read -p "Continue? [y/N] " yn
     [[ "$yn" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
     # idempotent clean install
     rm -rf "$SKILLS_DIR/skillnote-awareness" "$SKILLS_DIR/skillnote-resolver"
     mkdir -p "$SKILLS_DIR" "$OPENCLAW_HOME/skillnote"
     # download + extract
     curl -sf --connect-timeout 10 --max-time 30 "$API_URL/v1/openclaw-bundle.zip" -o /tmp/skillnote-openclaw.zip
     unzip -Z /tmp/skillnote-openclaw.zip 2>/dev/null | awk '{print $1}' | grep -q '^l' && {
       echo "Bundle contains symlinks; refusing"; rm -f /tmp/skillnote-openclaw.zip; exit 1
     }
     unzip -qo /tmp/skillnote-openclaw.zip -d "$SKILLS_DIR"
     mv "$SKILLS_DIR/config.template.json" "$OPENCLAW_HOME/skillnote/config.json"
     rm -f /tmp/skillnote-openclaw.zip
     echo ""
     echo "  ✓ Installed. Restart your OpenClaw session to pick up the new skills."
     echo "  Web: $WEB_URL"
     ```
   - Apply same `__API_URL__`/`__WEB_URL__` substitution as Claude Code setup endpoint.
2. Sanitize host with the existing `_re.match(r'^[a-zA-Z0-9._-]+$', raw_host)` pattern (already in `_derive_urls`).

**Verification:** `curl -s http://localhost:8082/setup/openclaw | head -20` returns valid bash with the host substituted; `curl -s http://localhost:8082/v1/openclaw-bundle.zip -o /tmp/o.zip && unzip -l /tmp/o.zip` lists 3 files (2 SKILL.md + 1 config.template.json).

**Commit:** `feat(backend): add /setup/openclaw bash installer + /v1/openclaw-bundle.zip`

---

### Task 11 — Settings → OpenClaw setup card UI

**Steps:**
1. Create `src/components/settings/openclaw-setup-card.tsx` (client component):
   - Card with title "OpenClaw Integration" and subtitle "Give your OpenClaw agent access to this SkillNote registry."
   - Computed install command from `apiUrl` (read from existing localStorage / env resolution): `curl -sf <API_URL>/setup/openclaw | bash`.
   - Display in monospace block with a "Copy" button (use existing `useClipboard` hook from `@/lib/hooks`).
   - Below: 3 bullets — "Drops 2 skills into ~/.openclaw/skills/", "Writes config to ~/.openclaw/skillnote/config.json", "Asks for one-time confirmation before installing".
   - Link to `docs/openclaw-integration.md` ("Learn more").
   - Status indicator: `GET /v1/openclaw/usage?limit=1` — if it returns ≥1 event in the last 7 days, show green dot "Connected (last activity: <time ago>)"; else gray dot "Not yet connected".
2. Mount in `src/app/(app)/settings/page.tsx` below existing cards.

**Verification:** `npm run dev` → open `localhost:3000/settings` → see card → click Copy → paste in terminal → matches `<API_URL>/setup/openclaw`.

**Commit:** `feat(web): add OpenClaw setup card to Settings page`

---

### Task 12 — User-facing docs

**Steps:**
1. Create `docs/openclaw-integration.md` (~1 page, plain English, no SDK jargon):
   - **What this is** — one paragraph.
   - **Install** — one command, runnable from anywhere.
   - **What gets installed** — list 2 skill files + 1 config file. Show paths.
   - **What the agent does after install** — 3 bullets: picks skills automatically, logs usage, leaves comments.
   - **What you do** — open SkillNote web UI, watch what your agent uses, reply to comments. (v2 has no UI feed — note "Activity feed coming in v2.1.")
   - **Uninstall** — `rm -rf ~/.openclaw/skills/skillnote-awareness ~/.openclaw/skills/skillnote-resolver ~/.openclaw/skillnote/`.
   - **Troubleshooting** — agent doesn't see SkillNote? Check `~/.openclaw/skillnote/config.json` exists and `skillnote_base_url` is reachable from the OpenClaw host.

**Commit:** `docs: add OpenClaw integration guide`

---

### Task 13 — Smoke test the full loop

**Why:** Type-check and unit tests verify code; this verifies the *product*.

**Steps:**
1. Bring up full stack: `docker compose up --build -d`.
2. `curl -X POST http://localhost:8082/v1/openclaw/context-bundle -H 'Content-Type: application/json' -d '{"task_summary":"Help draft a refund reply","max_skills":5}'` → returns JSON with skills + collections.
3. `curl -X POST http://localhost:8082/v1/openclaw/usage -H 'Content-Type: application/json' -d '{"agent_name":"smoke-test","task_summary":"smoke","skill_ids":[]}'` → 201, returns event with id.
4. `curl -X POST http://localhost:8082/v1/skills/<existing-slug>/comments -H 'Content-Type: application/json' -d '{"author":"openclaw-main","author_type":"agent","comment_type":"agent_observation","rating":4,"body":"smoke test reflection"}'` → 201.
5. `curl http://localhost:8082/v1/skills/<existing-slug>/comments` → returns array including the agent comment with new fields visible.
6. `curl http://localhost:8082/setup/openclaw` → returns valid bash; pipe to `bash -n` to syntax-check without executing.
7. `curl -s http://localhost:8082/v1/openclaw-bundle.zip -o /tmp/o.zip && unzip -l /tmp/o.zip` → lists expected files; check that `{{HOST}}` is substituted (`unzip -p /tmp/o.zip skillnote-awareness/SKILL.md | grep -c "{{HOST}}"` should be 0).
8. Frontend: `localhost:3000/settings` → OpenClaw card renders, Copy button works.
9. Run `cd backend && pytest -x` → all tests green.
10. Run `npx playwright test` → all E2E green.

**No commit** — this is verification before opening the PR.

---

### Task 14 — Open PR

**Steps:**
1. `git checkout -b feat/openclaw-foundation`
2. Verify all tasks committed.
3. `git push -u origin feat/openclaw-foundation`
4. `gh pr create --title "feat: SkillNote × OpenClaw foundation (v0.4.0)" --body "<HEREDOC>"` with body sections:
   - **Summary** — 3 bullets: new endpoints, new bundle, comments extension.
   - **Spec** — link to `skillnote_openclaw_living_skill_system_prd.md` and `asks.md`.
   - **What's NOT in this PR** — Activity UI, Agent Suggestions UI, Skill Garden, drafts table, marketplace candidates table. All deferred to v2.1. CLI tree (`cli/`) untouched — orphaned, separate deprecation PR.
   - **Test plan** — Task 13 checklist as markdown checkboxes.
   - **Migration safety** — `0015_openclaw_foundation` adds nullable columns + new table + pgvector extension; safe under concurrent writes; downgrade tested.
   - **Operator action required** — set `SKILLNOTE_EMBEDDING_API_KEY` before `./install.sh`.

---

## Engineering Bug Carryforward (from parked v1 review)

Any code in this plan that touches these patterns must obey:

1. **`func.case` does not exist.** Use `from sqlalchemy import case; case((cond, val), else_=...)`.
2. **Don't mix Python literals and SQL filters.** `Comment.author.in_([]) if [] else False` is broken. Either skip the filter when the list is empty, or use `from sqlalchemy import literal; literal(False)`.
3. **N+1 in context-bundle is the obvious failure mode.** Pre-aggregate ratings, usage counts, and recent comments into dicts before the per-skill loop. Test with a query-count assertion (Task 4).
4. **Server-side defaults on new NOT NULL columns** must use `server_default` in the migration (already specified for `comments.author_type`).
5. **`metadata` is a reserved attribute on SQLAlchemy declarative Base.** The column is named `metadata_json` in the DB to avoid collision (already specified).

---

## Out of Scope (deferred to v2.1)

- `skill_drafts` table + draft creation/approval flow (PRD §10.4, FR7).
- `marketplace_candidates` table + recording flow (PRD §13.5, FR10).
- OpenClaw Activity UI (PRD §11.6).
- Agent Suggestions UI (PRD §11.6).
- Skill Garden dashboard (PRD §11.6, FR9).
- LLM-assisted staleness detection (PRD §21 Q8) — v2 uses rule-based.
- Multi-agent support (PRD §21 Q5) — v2 assumes single OpenClaw install per machine.
- Resolver decision logging for debugging (PRD §21 Q7).
- Awareness skill self-update mechanism — v2 requires manual re-run of install command.
- Hybrid ranking (semantic + recency + rating boost weighted) — v2 is pure cosine. Worth A/B testing in v2.1 once we have real usage data.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Resolver returns garbage JSON because the prompt isn't tight enough | High | Task 9 verification step + plan to iterate on the skill body in v2.0.x patches without full PR cycle. |
| `context-bundle` slow for >100 skills | Medium | Query-count assertion in Task 4 tests; covering index in Task 1 if profiling shows need. |
| Users run install command without reading the consent prompt | Low | Consent prompt is interactive `read -p` — bash exits if not piped to a TTY. Note: `curl | bash` *is* a TTY, but if user pipes through `cat`, the prompt is skipped → that's OK because they were intentional. |
| Agent leaks raw user messages into `task_summary` despite the rule | Medium | Soft check in Task 5 (>1000 chars → 422). Hard enforcement requires LLM judging — not in v2. Doc the rule in awareness skill (Task 8). |
| The bash installer breaks on Linux | Low | Existing Claude Code setup script is the same shape and works on both. CI doesn't run the installer; manual verification on macOS only for v2. |
| Operator upgrades to 0.4.0 without setting `SKILLNOTE_EMBEDDING_API_KEY` | High | Startup logs WARNING (Task 2.5 step 3); context-bundle returns 503 with clear `EMBEDDING_NOT_CONFIGURED` code; CHANGELOG and `docs/openclaw-integration.md` flag the requirement. Existing skill CRUD endpoints continue to work (skills just have NULL embedding until backfill). |
| OpenAI rate-limits `embed_text` during high context-bundle load | Medium | LRU cache (Task 2.5) deduplicates identical task summaries. Per-request retry with backoff in embedding_service. If rate-limit persists → 502 to client; resolver subagent retries on next user turn. |
| pgvector image swap breaks existing operators on `postgres:16` | Medium | Document the image change in CHANGELOG. The `vector` extension can be added to vanilla postgres via `apt-get install postgresql-16-pgvector` if operators prefer not to swap images — note both paths in upgrade docs. |
| Embedding cost balloons (operator with 10k skills) | Low | text-embedding-3-small is $0.02/1M tokens. 10k skills @ ~100 tokens each = 1M tokens = $0.02 one-time. Per-request task_summary embedding: 50 tokens × 1000 requests/day = 50k tokens = $0.001/day. Negligible at all realistic scales. |
