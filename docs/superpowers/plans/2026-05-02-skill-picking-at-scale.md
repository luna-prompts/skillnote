# Skill Picking at Scale — post-release plan

**Status:** Parked, to be picked up after first release of SkillNote × OpenClaw.
**Date:** 2026-05-02
**Owner:** TBD

---

## The problem

Today, the OpenClaw plugin syncs every skill in the registry into `~/.openclaw/skills/sn-*/`. The agent picks which skills to use by reading frontmatter descriptions in its system prompt. This works for the current 22-skill catalog but breaks at scale:

- **~50 skills**: 5–7% of context window burned on skill menus before any user message arrives
- **~100 skills**: picking accuracy drops below 50% in production research
- **Beyond 100**: the dominant production pattern is RAG (retrieval-augmented generation) over skill descriptions

OpenClaw is autonomous (cron, Slack, Discord, email — no human start), so we can't push the picking decision to the user via a collection picker the way Claude Code does. The agent has to figure out which skills to apply on its own.

This plan covers the two highest-leverage post-release improvements, in priority order.

---

## Research summary (what we know works)

Three patterns have converged in production AI agents (Anthropic Tool Search Tool, AWS Bedrock AgentCore, LangChain `langgraph-bigtool`, Composio Tool Router, Lindy.ai per-channel agents):

1. **Semantic retrieval over skill descriptions** (vector DB + cosine search) — the workhorse
2. **Resolver subagent (LLM as re-ranker)** on top of vector search — adds judgment to similarity
3. **Code-execution-as-discovery** — return file paths, agent reads only what it needs (Anthropic's newest pattern, 98.7% token reduction)

Combined as a two-stage RAG pipeline:

```
Skill descriptions → embed once → pgvector store

At query time:
  task → embed → cosine top-10 → LLM re-rank → top-3 file paths → main agent
```

Key numbers from production data:

| Source | Result |
|---|---|
| Anthropic Tool Search Tool (Opus 4) | 49% → 74% accuracy, 85% token reduction |
| AWS Bedrock 422-tool benchmark | 82.3% accuracy, $0.015/query (vs $0.202 baseline) |
| Composio MCP description tuning alone | 33% → 74% accuracy |

---

## Item 1 — Description quality enforcement

**Why first:** Composio's data says description tuning is the single biggest accuracy lever (33% → 74%). Cheapest to build (no new infra). Improves picking even with the current naive flow, before resolver lands.

### Scope

Three layers, lightest-touch first. Pick whichever gets shipped:

#### Path A — Just show the guidance (recommended starting point)

- Edit and create-skill forms display: *"Tip: open with 'Use when…' to give agents clear trigger criteria. Example: 'Use when reviewing PRs that touch authentication code. Walks through OWASP top-10 checks specific to auth flows.'"*
- 2 example good descriptions visible under the field at all times
- No scoring, no judgment, no false positives
- **Cost: ~80 LOC frontend only, hours not days**

#### Path B — LLM-as-judge for description quality

- On `POST /v1/skills` and `PATCH /v1/skills/{slug}`, run description through Haiku-class LLM
- Returns score 1–5 + one-line "make it better" hint
- ~$0.0001 per push, ~200ms latency
- Adds Anthropic API key requirement to backend (deal-breaker for self-hosted users without one — make it optional)
- **Cost: ~300 LOC, ~1 day**

#### Path C — Regex/heuristic scorer (NOT recommended)

We considered this earlier with a `WEAK_OPENERS` / `TRIGGER_LANGUAGE` token list and a 0–100 scoring function. **Rejected.** The heuristic creates both false positives ("Use a CDN before deploying" matches `before` but isn't trigger-criteria language) and a false sense of security (scoring 80 doesn't mean it's good — it means it passed the regex). Skip.

### Recommendation

Ship Path A first (just guidance). Add Path B if usage telemetry shows users aren't following the guidance organically. Composio's published 33%→74% number was achieved by *manual review and rewriting* — they didn't use a regex scorer. So the path forward is "teach the user via UI" before "auto-judge with LLM."

### Files that change

- `src/components/skills/skill-edit-tab.tsx` — tip + examples under description field
- `src/components/skills/new-skill-modal.tsx` — same
- `backend/app/api/skills.py` (Path B only) — call LLM judge, add result to response
- `backend/app/services/description_judge.py` (Path B only) — new

### What stays out of scope

- Blocking publishes on bad descriptions (we nudge, don't block)
- Retroactive scoring of existing skills (apply on next edit only)
- Cross-language description quality (English-only for v1)

### Cost estimate

- Path A only: ~80 LOC, half a day
- Path A + Path B: ~400 LOC, 1.5 days

---

## Item 2 — Resolver subagent / RAG endpoint

**Why second:** Doesn't make sense to invest here until descriptions are higher quality (Item 1) and we've validated demand (catalogs growing past 30+ skills). When triggered, this is the structural fix that scales to 1000+ skills.

### Architecture

Two-stage RAG, collapsed into a single backend endpoint (resolver lives server-side, not as a separate OpenClaw skill — simpler than the v1 design):

```
┌─────────────────────────────────────────────────────────────┐
│ Skill registry (100s of skills)                             │
│ row: id, slug, description, embedding (vector(1536))        │
└─────────────────────────────────────────────────────────────┘
                       ▲
   On skill push/edit:  │ embed(description), store in row
   one-time per skill   │
                       │
                       │
┌──────────────────────┴──────────────────────────────────────┐
│ POST /v1/openclaw/resolve                                    │
│   {task: "fix the auth null deref bug",                      │
│    channel: "slack/eng",                                     │
│    sender: "...",                                            │
│    active_collection: "backend",                             │
│    top_n: 5}                                                 │
│                                                              │
│ Inside the endpoint:                                         │
│   1. embed(task)                                             │
│   2. pgvector cosine search filtered by collection → top 10  │
│   3. small LLM re-rank top 10 against task → top 3-5         │
│   4. boost by recency + rating signals from skill_usage_events│
│   5. return [{slug, path, score, reasons}, ...]              │
└──────────────────────────────────────────────────────────────┘
                       │
                       ▼
            Main OpenClaw agent reads only those file paths
            via its Read tool. No full SKILL.md content in context
            until needed.
```

### Components

#### 1. pgvector setup
- Migration `0005_add_skill_embeddings.py` — `CREATE EXTENSION vector`, `ALTER TABLE skills ADD COLUMN description_embedding vector(1536)`, ivfflat index
- Bundle pgvector in our docker-compose Postgres image so self-hosters get it for free

#### 2. Embedding service
- `backend/app/services/embedding.py` — provider abstraction
- Default: OpenAI `text-embedding-3-small` (1536 dims, $0.02/1M tokens, ~$0.000004 per skill)
- Configurable via `SKILLNOTE_EMBEDDING_PROVIDER` env (`openai|cohere|local`)
- Local fallback: `bge-small-en` via sentence-transformers (~120MB model, zero API cost)
- Re-embed on: skill create, description edit (async, doesn't block API response)

#### 3. Resolver endpoint
- `POST /v1/openclaw/resolve` — request/response shape above
- Server-side caching by `(task_hash, collection_hash)` for 60s — agent calling it twice in a turn doesn't pay twice
- Validate returned slugs against actual skill table (prevents hallucinated names)
- Sort by score with deterministic tie-break (avoid first-tool bias)

#### 4. Channel/collection pre-filter
- New field in OpenClaw `config.json`:
  ```json
  "channel_collections": {
    "slack/support": "support",
    "slack/eng": "engineering",
    "_default": null
  }
  ```
- Resolver consults this when picking active collection
- Web UI Connect → OpenClaw tab gets a "channel → collection" mapper

#### 5. Main SKILL.md update — threshold-activated invocation

New step in setup OR new behavior in the AGENTS.md graft:

```
Step 3.5 — Pick which skills to use (only if >15 sn-* skills synced)

After sync, count: ls ~/.openclaw/skills/sn-* | wc -l

- count ≤ 15: use existing flow (read frontmatter from system prompt)
- count > 15: invoke resolver before reading any sn-* file:
    POST {{HOST}}/v1/openclaw/resolve
      {"task": "<paraphrase>",
       "channel": "<channel>",
       "active_collection": "<from config or null>",
       "top_n": 5}
  Read only the SKILL.md files from the response. Don't read all of them.
```

#### 6. Backfill job
- `backend/scripts/backfill_embeddings.py` — one-time embedding for existing skills
- Idempotent — skips skills with current text-hash already embedded

### Files that change / get created

**Backend (~800 LOC):**
- `backend/alembic/versions/0005_add_skill_embeddings.py` (NEW)
- `backend/app/db/models/skill.py` — add `description_embedding` column
- `backend/app/services/embedding.py` (NEW) — provider abstraction
- `backend/app/api/openclaw.py` — `POST /v1/openclaw/resolve`
- `backend/app/api/skills.py` — trigger embedding on create/update
- `backend/scripts/backfill_embeddings.py` (NEW)
- `backend/app/core/config.py` — `SKILLNOTE_EMBEDDING_*` settings
- `backend/pyproject.toml` — `pgvector`, `openai` (or `sentence-transformers`)

**Plugin (~150 LOC):**
- `plugin-openclaw/skillnote/SKILL.md` — Step 3.5
- `plugin-openclaw/skillnote/sync.sh` — pass `channel_collections` to resolver
- `backend/seed_data/skillnote.skill/SKILL.md` — mirror

**Web UI (~250 LOC):**
- `src/app/(app)/integrations/page.tsx` — channel mapper section
- `src/components/settings/openclaw-channel-mapper.tsx` (NEW)

**Tests (~400 LOC):**
- `backend/tests/integration/test_resolve_endpoint.py` (NEW)
- `backend/tests/unit/test_embedding_service.py` (NEW)
- `backend/tests/integration/test_resolver_ranking.py` (NEW)

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| pgvector adds operational complexity for self-hosters | Bundle the extension in docker-compose Postgres image |
| Embedding API key requirement for default config | Ship `local` provider as fallback (sentence-transformers) |
| Resolver returns hallucinated slugs | Validate against actual skill table before returning |
| Cost runaway if agent calls resolver per-turn | Cache by task hash for 60s; SKILL.md says "once per task, not per turn" |
| First-tool bias in returned top-K | Score-desc with deterministic tie-break by slug |
| Backfill job runs on every restart | Skip skills with embeddings + matching text hash |
| Channel pre-filter too aggressive | Resolver broadens to all collections if filtered result < 2 skills |

### Cost estimate

~1600 LOC, ~6 working days (matches the "week" estimate)

### What this DOESN'T solve

- Multi-step task planning ("first do X, then if Y, do Z")
- Cross-skill conflicts ("two skills both apply, agent picks the wrong one")
- Real-time skill discovery from external sources (web, MCP servers)

---

## Suggested order (post-first-release)

1. **Item 1, Path A only** (just-show-guidance) — ships in hours, improves picking quality even with the current flow. No new infra.
2. **Channel/collection pre-filter** — lift the existing collection mechanism into OpenClaw's sync.sh. Doesn't need embeddings; just threads `?collection=` through the existing `/v1/skills` endpoint. Days, not weeks.
3. **Item 2 (resolver + embeddings)** — the bigger investment. Lands on a foundation where descriptions are already higher-quality and channel filtering is already working.

This order means the resolver's accuracy numbers will be best on day one, because descriptions are tuned and the pre-filter is doing some of the work.

---

## Anti-patterns to avoid (from research)

- **Pure semantic search fails on synonym-heavy domains.** `get_hotel_details` vs `get_hotel_pricing` both score similar on "tell me about this hotel." Mitigation: hybrid BM25 + embeddings, strict trigger criteria in description.
- **LLM resolvers hallucinate skill names.** Constrain output to enum of real slugs.
- **First-tool bias** — LLMs disproportionately pick the first option in a list. Sort with deterministic tie-break.
- **"Loops forever calling same tool"** — hard step caps in resolver loop.
- **Tool-Flood adversarial attack** — broad-described skills can hide narrower ones. Validate descriptions on publish.
- **Don't use a regex/heuristic description scorer** (rejected above) — false positives create noise, false sense of security.

---

## Open questions for when we pick this up

1. Do we ship local-embedding (sentence-transformers) as the default, or OpenAI? Affects out-of-box experience for self-hosters without API keys.
2. Should the resolver's LLM re-ranker be configurable per-instance, or hardcoded to one model?
3. How aggressive is the cache? 60s seems right but could be longer.
4. Do we expose the resolver as a public API for non-OpenClaw clients (Claude Code, custom tooling)?
5. Description quality nudges in the web UI — opt-in (toggle) or always-on?
6. When the resolver returns nothing (cold start, all-zero embeddings, etc.) — fall back to "all skills" or fail?

---

## Sources

- [Anthropic — Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Anthropic — Introducing advanced tool use (Tool Search Tool)](https://www.anthropic.com/engineering/advanced-tool-use)
- [Anthropic — Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Anthropic — Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [AWS — Optimize agent tool selection using S3 Vectors and Bedrock](https://aws.amazon.com/blogs/storage/optimize-agent-tool-selection-using-s3-vectors-and-bedrock-knowledge-bases/)
- [LangChain — langgraph-bigtool GitHub](https://github.com/langchain-ai/langgraph-bigtool)
- [Composio — Tool Router](https://composio.dev/blog/introducing-tool-router-(beta))
- [Lindy — Agent Steps documentation](https://docs.lindy.ai/fundamentals/lindy-101/ai-agents)
- [Slack — Slackbot context-aware AI agent](https://slack.com/blog/news/slackbot-context-aware-ai-agent-for-work)
- [Galileo — 7 AI Agent Failure Modes](https://galileo.ai/blog/agent-failure-modes-guide)
- [LeanIX Engineering — Why Your AI Agent Is Drowning in Tools](https://engineering.leanix.net/blog/code-mode/)
- [Agentskills.io — Optimizing skill descriptions](https://agentskills.io/skill-creation/optimizing-descriptions)
