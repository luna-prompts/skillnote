# Analytics & Tracking Quality — post-release plan

**Status:** Parked, to be picked up after first release.
**Date:** 2026-05-02
**Owner:** TBD
**Adjacent plan:** `2026-05-02-skill-picking-at-scale.md` (RAG / resolver / description quality)

---

## Why this plan exists

The analytics plumbing **works** end-to-end (verified by parsing actual session logs, log-watcher state files, and the backend `skill_call_events`/`skill_usage_events`/`comments`/`skill_ratings` tables on a live remote install). But the **signal quality is poor**: of the 12 things we should be tracking, 4 work well, 4 are captured-but-unused, 4 are missing entirely, and **1 is producing actively wrong numbers due to a dedup bug across daemon restarts.**

This plan fixes the bug and closes the gaps in priority order.

---

## What's working (verified)

| Channel | Verification |
|---|---|
| `POST /v1/hooks/skill-used` (log-watcher → backend) | Daemon state shows skill reads being detected; backend `skill_call_events` table receives them |
| `POST /v1/openclaw/usage` | 14 events recorded with correct `agent_name`, `task_summary`, `channel`, all returning HTTP 201 |
| `POST /v1/skills/{slug}/comments` with rating | 26 agent comments in DB; ratings fan out to `skill_ratings` table; `rating-summary` endpoint reflects them |
| Per-session deduplication **within one daemon lifecycle** | E2E test S23 verified: 3 reads → 1 event |
| `.trajectory.` and `.reset.` exclusion | Verified |
| Daemon offset preservation across restart **when state file persists** | Verified — no replay |
| Comment-with-rating → `skill_ratings` fan-out | Verified after Docker restart fix; rating_summary moves correctly |

So the plumbing is solid. The problems are at the signal/data-integrity layer.

---

## Verified findings (live database snapshot, 2026-05-02)

### 🔴 CRITICAL — Dedup breaks across daemon state-file resets (NEW finding from this audit)

**Symptom:** One `session_id` × `skill_slug` pair fires the event up to **25 times** in `skill_call_events`. Per-session dedup is supposed to guarantee 1 event per pair.

**Hard data — same `(session, slug)` repeating in production:**
```
session_id                            skill_slug                    fires
c22a8a3b-ba9c-442b-8d11-9ddb54a756cd  error-handling                25
fd236480-476a-459b-a214-3f2a306dee48  dispatching-parallel-agents   21
```

**Root cause:** When `~/.openclaw/skills/skillnote/.log-watcher-state.json` is wiped (manual reset, install rotation, plugin update), the daemon next starts with no record of which `(file, session, slug)` triples it has already seen. Every existing session JSONL on disk is re-read from offset 0, and every skill-read event in those files is re-fired.

**Production impact:**
- `call_count` numbers are inflated whenever a daemon resets. After a `clawhub update skillnote` that touches the bundle, all skill counts get amplified.
- Time-series accuracy is corrupted (one read becomes N events spread over the cron-restart times).
- Unique session counts are reliable; per-session counts are not.

**Fix options:**
- **Option A (preferred):** When daemon starts and finds no state for an existing session file, advance its offset to `os.stat(path).st_size` (treat unknown files as "starting from now") instead of reading from 0.
- **Option B:** Persist `seen_slugs` per-session in a separate sidecar file that survives state-file deletion.
- **Option C:** On startup, mark every existing JSONL line as "already processed" before any POST is allowed, then process new lines only.

**Recommendation: Option A** — minimal code change in `log-watcher.py`, no schema changes, no migration. Adds about 5 lines.

**Cost:** Half a day including a dedicated test scenario in the E2E suite (write a session file → kill daemon → wipe state → restart → confirm no fires).

---

### 🔴 GAP 1 — `skill_ids` array empty on 86% of usage events

**Hard data:**
```
total: 14    empty: 12    populated: 2    (86% empty)
```

The two populated events are from one of my manual E2E test runs that hard-coded an ID; everything else has `skill_ids: []`.

**Root cause:** SKILL.md "How to log usage" says *"Use the id field from each skill's frontmatter"* — but synced `sn-*/SKILL.md` files don't have an `id:` field. We removed it during the v2 GitHub-origin refactor. The agent has nothing to put in `skill_ids[]` and posts an empty array.

**Production impact:** Usage events can't be joined to specific skills. Almost every analytics query that wants to ask *"this task used skill X"* is impossible.

**Fix options:**
- **Option A:** Restore `id:` field in synced frontmatter for skills with DB UUIDs (not GitHub-origin). Half-day.
- **Option B:** Make the API accept `skill_slugs[]` instead of (or alongside) `skill_ids[]`. Looser coupling to UUIDs. Migration friendly.
- **Option C:** Both — accept either, prefer slugs in client guidance.

**Recommendation: Option C.** Backend accepts both fields, SKILL.md tells the agent to send slugs. Slugs are stable, human-readable, and present in every sn-* dir name. UUIDs only matter for very old integrations.

**Cost:** ~150 LOC backend, ~10 lines SKILL.md, half a day.

---

### 🔴 GAP 2 — Every outcome is "completed" (no failure signal)

**Hard data:**
```
outcome: completed  count: 14
outcome: failed     count: 0
outcome: abandoned  count: 0
outcome: unknown    count: 0
```

100% of recorded events are `completed`. The agent always picks the optimistic path because SKILL.md never tells it when to use the others.

**Production impact:** `completion_rate` on every skill is 100% by construction. Useless as a signal for skill quality, drift detection, or bad-description identification.

**Fix:** Add explicit guidance to SKILL.md "How to log usage":
- `completed` — skill applied and produced the intended result
- `failed` — skill applied but produced wrong result, error, or didn't help (include one-line diagnosis in `task_summary`)
- `abandoned` — agent considered skill but didn't finish applying (timeout, user interrupted, decided wrong skill)
- `unknown` — unsure (only when truly uncertain — bias toward one of the above)

Also add to AGENTS.md graft: *"After completing the task, post outcome honestly. If a skill didn't help, post `failed` with the reason — that's the only way the registry learns."*

**Cost:** ~30 LOC (SKILL.md + AGENTS.md template), no backend changes. Few hours.

---

### 🔴 GAP 3 — `linked_usage_id` never populated (0/26 = 0%)

**Hard data:**
```
total_agent_comments: 26    with_link: 0    orphan: 26
```

The schema has `comments.linked_usage_id` (added months ago for exactly this purpose). Not a single comment uses it.

**Root cause:** SKILL.md "How to reflect on a skill" doesn't mention `linked_usage_id`. The agent doesn't know it exists.

**Production impact:** Can't ask *"of the 23 times brainstorming was used, what % got positive ratings?"* Or *"this rating from agent X — what task was it about?"* The data exists but the join is missing because the FK is always null.

**Fix:** Update SKILL.md to mention `linked_usage_id`:
```json
{
  "author": "...",
  "author_type": "agent",
  "comment_type": "agent_success_note",
  "rating": 5,
  "linked_usage_id": "<id from the just-posted /v1/openclaw/usage response>",
  "body": "..."
}
```

Backend already supports it. Just need to teach the agent.

**Cost:** ~20 LOC SKILL.md, no schema changes. Hours.

---

### 🟡 GAP 4 — Channel data captured but not used in analytics

**Hard data:**
```
channel: e2e        count: 12
channel: cli        count: 1
channel: webchat    count: 1
```

Channels are stored. Not surfaced anywhere. Analytics endpoints don't filter or group by channel.

**Production impact:** For autonomous OpenClaw use across multiple channels (Slack `#support`, Discord `#eng`, email, cron), we lose the most actionable insight: *"which skills do I use in #support vs #eng?"*

**Fix:**
- Add `?channel=` filter to `/v1/analytics/top-skills`, `/v1/analytics/skill-calls`, `/v1/analytics/summary`
- Add `/v1/analytics/channels` endpoint returning channel breakdown
- Web UI: channel selector on Analytics page; channel breakdown chart

**Cost:** ~250 LOC backend, ~150 LOC web UI, ~1 day.

---

### 🟡 GAP 5 — `agent_name` mostly defaults to `"main"` / `"openclaw-main"`

**Hard data (production OpenClaw events only):**
```
openclaw-main: 174
main: 2
```

(The `e2e-*` agents are from my test scripts.)

OpenClaw supports multiple isolated agents per machine. Today they all collapse to `"main"` because the AGENTS.md graft and SKILL.md template hardcode it.

**Production impact:** When a single OpenClaw install has multiple specialized agents (a support-bot agent, a dev-helper agent), they all show as `main` in analytics. Multi-agent visibility is invisible.

**Fix options:**
- **Option A:** sync.sh detects the actual agent name from OpenClaw's CLI/state at graft time and writes the real value.
- **Option B:** SKILL.md tells the agent to introspect its own identity (read from `~/.openclaw/agents/main/agent/` config or call `openclaw agents list`) and use that name.

**Recommendation: Option A.** sync.sh is the right place because it runs at install and on every sync; the real agent name is knowable at that point.

**Cost:** ~50 LOC sync.sh, ~20 LOC SKILL.md update, ~half a day.

---

### 🟡 GAP 6 — "Read ≠ Used" — `call_count` is misleading

**The issue:** log-watcher fires `skill-used` whenever the file is read. But "agent read the file" doesn't mean "agent applied the skill." Agent might read it, decide it's irrelevant, ignore it.

**Hard data evidence:** error-handling has 51 reads but only 1 usage event mentioning it (after we filter test data). That's 50× more reads than applications.

**Fix:**
- Rename `call_count` → `read_count` in API responses + UI
- Introduce separate `applied_count` derived from `usage_events` where `skill_slugs[]` (or `skill_ids[]`) contains the skill — depends on **GAP 1** being fixed first
- Surface both in UI: `Reads: 51 · Applied: 8 · Apply rate: 16%`

**Cost:** ~100 LOC backend (new SQL view), ~80 LOC UI, ~half a day. Blocked by GAP 1.

---

### 🟡 GAP 7 — No "considered but rejected" signal

**The issue:** Agent reads a skill, decides it's wrong for the task, doesn't apply it. Today: silent. We learn nothing.

If we knew "agent considered this skill but rejected it," we could:
- Flag skills with high reject rates as potentially mis-described (links into the description-quality plan)
- Surface improvement suggestions to skill authors
- Train better description heuristics

**Fix:** Add a sixth `comment_type` value: `agent_rejection`. Agent posts a one-liner:
> *"Read this skill but didn't apply it — task was about Y, skill is for X. Trigger criteria didn't match."*

Low cost, high signal — especially for the resolver/description-quality plan.

**Cost:** ~30 LOC backend (Literal enum + validator), ~20 LOC SKILL.md, ~hours.

---

### 🟢 GAP 8 — Cost / latency / token tracking

Don't know how long agent spends per task or token cost. For cost-conscious teams (the kind who self-host SkillNote), this is a meaningful gap.

**Lower priority** — captures a useful but non-critical signal. Tracking would require capturing timing data the agent has but never reports. Defer.

---

### 🟢 GAP 9 — Human-side rating loop is missing

Agent ratings work. There's no equivalent on the user side beyond posting full text comments. No quick thumbs-up/down on a skill page.

**Fix:** thumbs-up/thumbs-down buttons on each skill page that post a `human_review` comment with rating 5/1.

**Cost:** ~80 LOC web UI, ~20 LOC backend (just enforce a `human_review` comment_type). Half a day.

---

## Tracking maturity scorecard

| Signal | Captured? | Used in analytics? | UI surfaces? | Production-ready? |
|---|---|---|---|---|
| Skill file read (implicit) | ✅ | ✅ as `call_count` | ✅ | ⚠️ Misleadingly named — read ≠ used |
| Same-session re-read dedup (within daemon lifecycle) | ✅ | ✅ | — | ✅ Working |
| Same-session re-read dedup (across daemon restarts) | ❌ | ❌ | — | 🔴 **CRITICAL BUG — events replay on state-file reset** |
| Skill applied (explicit usage event) | ✅ but with empty `skill_ids` | ⚠️ | ⚠️ list only, no breakdowns | ❌ `skill_ids` bug means joins broken (86% empty) |
| Outcome (completed/failed/abandoned) | ✅ | ✅ as `completion_rate` | ⚠️ | ❌ Always `completed` (100% of events) |
| Rating (1-5) | ✅ | ✅ as `avg_rating` | ✅ | ✅ Working |
| Comment body (qualitative) | ✅ | — | ✅ | ✅ Working |
| Channel/source | ✅ stored | ❌ not filterable | ❌ | ❌ Data captured but unusable |
| Agent name | ✅ stored | ❌ always "main" / "openclaw-main" | ❌ | ❌ Multi-agent invisible |
| Read↔Applied correlation | ❌ | — | — | ❌ Conflated as one metric |
| Usage↔Comment correlation | ⚠️ schema exists (`linked_usage_id`) | ❌ never populated (0/26) | ❌ | ❌ Bug — agent never sets the field |
| "Rejected/considered but not used" | ❌ | — | — | ❌ Whole signal missing |
| Cost / latency / tokens | ❌ | — | — | ❌ Whole signal missing |
| Human ratings (thumbs/quick) | ⚠️ schema supports | — | ❌ no UI | ❌ Surface gap |

---

## Suggested order (post-first-release)

Priority is descending: critical bug first, then data-integrity gaps, then visibility gaps, then enrichment.

1. **Critical bug — dedup across daemon restarts (Option A: skip-to-EOF on unknown file).** Half a day. **Blocks accuracy of every other read-based metric.** Without this, fixing other gaps is masked by inflated baseline numbers.

2. **GAP 1 — populate `skill_ids[]` (slugs preferred).** Half a day. Unlocks usage↔skill joins. Required for GAP 6 to work.

3. **GAP 2 — outcome reporting guidance.** Hours. Cheap. Without honest outcomes, `completion_rate` is meaningless.

4. **GAP 3 — `linked_usage_id` population.** Hours. Cheap. Unlocks rating-per-task analysis.

5. **GAP 5 — real agent_name in graft/usage.** Half a day. Multi-agent visibility.

6. **GAP 4 — channel filter + channel UI.** ~1 day. Unlocks per-channel analytics — important for autonomous use.

7. **GAP 6 — read vs applied counts.** Half a day. Surfaces the apply-rate signal users will actually want once GAP 1 is fixed.

8. **GAP 7 — `agent_rejection` comment_type.** Hours. Cheap, high signal for description-quality work later.

9. **GAP 9 — human thumbs UI.** Half a day. Closes the human/agent rating asymmetry.

10. **GAP 8 — cost/latency tracking.** Defer. Bigger lift, lower urgency.

**Total for items 1–9:** ~4 days end-to-end. Most items are independent and can be parallelized.

---

## What this plan DOESN'T cover

- The skill-picking RAG / resolver work (covered in `2026-05-02-skill-picking-at-scale.md`)
- Description quality enforcement (also in the picking plan)
- Real-time streaming analytics (assumed batched is fine for the foreseeable future)
- Cross-instance analytics (federated SkillNote — out of scope)

---

## Open questions for when we pick this up

1. **Backwards compatibility for `skill_ids` → `skill_slugs`** — keep both fields forever, or deprecate `skill_ids`?
2. **Human rating UI** — thumbs only, or 1–5 stars matching agent ratings?
3. **Channel taxonomy** — free-form strings (today) or constrained enum? Affects discoverability in the web UI.
4. **Agent name detection** — what's the canonical OpenClaw API to introspect "what am I called"?
5. **Skill pruning suggestions** — once we have apply-rate + reject signals, do we surface "this skill has high read-count but low apply-rate, consider rewriting its description"? Could be a doctor-skill check.
6. **State-file persistence semantics** — should `clawhub update skillnote` preserve `.log-watcher-state.json`? (Today: depends on whether clawhub treats it as user-data or skill-data.)

---

## Sources

- Verified live by parsing `~/.openclaw/skills/skillnote/.log-watcher-state.json` on a remote test machine and cross-referencing with backend `skill_call_events`, `skill_usage_events`, `comments`, `skill_ratings` tables on the local backend (`localhost:8082`).
- Earlier E2E test script: `/tmp/install_test_suite_v2.sh` (validated happy-path before this audit).
- Adjacent picking plan: `docs/superpowers/plans/2026-05-02-skill-picking-at-scale.md`.
