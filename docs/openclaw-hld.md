# SkillNote × OpenClaw — High-Level Design

> The complete system design for how the SkillNote registry integrates with OpenClaw.
> Covers the user journey, the runtime components, the three loops that drive it,
> the feedback channels back to the registry, and how the design handles failures.

---

## 1. The user journey (what a developer experiences)

The user does **one thing**: tells their agent to install the skill via clawhub. Everything else — including standing up the SkillNote backend, configuring the URL, syncing the catalog, wiring AGENTS.md — the agent handles by following the SKILL.md's instructions.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Day 0 — One user prompt                                                 │
│    User types into OpenClaw:  "install skillnote from clawhub"          │
│    (Equivalent: user runs `clawhub install skillnote` themselves)       │
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Day 0 — Skill files land on disk                                        │
│    clawhub fetches the skill bundle and writes:                         │
│      ~/.openclaw/skills/skillnote/                                      │
│        ├── SKILL.md            ← always-loaded; drives everything       │
│        ├── sync.sh             ← runs every 60s                         │
│        ├── log-watcher.py      ← analytics daemon                       │
│        ├── install-backend.sh  ← bootstraps the backend if missing      │
│        ├── config.template.json                                         │
│        ├── VERSION                                                      │
│        └── references/                                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Day 0 — Next OpenClaw session: SKILL.md takes over (6 steps)           │
│                                                                          │
│  Step 1: Resolve host (env → file → default localhost:8082)             │
│          Reach test                                                     │
│          ├── reachable     → skip to Step 3                             │
│          └── unreachable   → continue to Step 2                         │
│                                                                          │
│  Step 2: STAND UP THE BACKEND (only when localhost is unreachable)      │
│          Ask user: "may I install the backend? [Y/n]" ← consent #1      │
│          On Y, run: bash ~/.openclaw/skills/skillnote/install-backend.sh│
│            • git clone https://github.com/luna-prompts/skillnote.git    │
│            • cd skillnote && ./install.sh   (Docker compose, ~3 min)    │
│            • Poll /health until ready                                   │
│          Recovery if script missing:                                    │
│            curl -sfL <github-raw>/install-backend.sh | bash             │
│                                                                          │
│  Step 3: Persist resolved host to ~/.openclaw/skillnote/config.json     │
│  Step 4: chmod +x sync.sh && first sync → 22 sn-* skill dirs appear     │
│          log-watcher.py daemon spawns (PID-guarded)                     │
│          sync.sh ALSO grafts <skillnote v1> into AGENTS.md (idempotent) │
│  Step 5: Verify AGENTS.md graft is present (no file edit, no prompt)    │
│  Step 6: "SkillNote connected ✓ N skills synced"                        │
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Day 1+ — Every session, silently                                       │
│    Before any task: agent runs sync.sh → reads relevant sn-*/SKILL.md   │
│    After any task: agent POSTs usage event with skill_ids + outcome     │
│    In-turn: if a skill helped, agent runs the pre-filled rating curl    │
│    Background: log-watcher silently tracks every SKILL.md the agent     │
│                opened, fires hooks/skill-used to backend                 │
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  Day 7 — Web UI feedback loop                                           │
│    Developer opens skillnote.local → Analytics → sees:                  │
│      • Top skills (by call_count from log-watcher)                      │
│      • Avg rating per skill (from agent ratings)                        │
│      • Per-agent activity                                               │
│      • Agent comments (observation/issue/success_note) inline w/ skills │
│    Developer edits a skill → next sync (≤60s) → agent has new content   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Total user input

- **1 prompt:** "install skillnote from clawhub"
- **At most 1 Y/n answer:** consent to install the backend (only fires when localhost:8082 is unreachable). The AGENTS.md graft happens silently inside `sync.sh` — no second prompt. (See §8 for why.)
- That's it. No clone, no `./install.sh`, no URL prompt, no manual config.

### Four install methods on the Connect page (web UI)

For users who'd rather click than type, the web UI's Connect → OpenClaw tab offers four equivalent paths. All converge to the same on-disk state.

| Method | Command | When |
|---|---|---|
| **Copy prompt** *(default tab)* | Personalized prompt with user's URL pre-baked, served from `/setup/agent-prompt?agent=openclaw` | Recommended — zero terminal |
| **clawhub** | `SKILLNOTE_BASE_URL=… clawhub install skillnote` | Power users with the plugin manager |
| **curl** | `curl -sf <host>/setup/agent \| bash -s -- --agent openclaw` | When clawhub isn't available |
| **Manual** | 4-step bash block | Air-gapped environments |

---

## 2. Component map

```
┌──────────────────────────────── HOST MACHINE ─────────────────────────────────┐
│                                                                                │
│   ┌─────────────────────┐         ┌──────────────────────────────────────┐   │
│   │   OpenClaw runtime  │         │   ~/.openclaw/                        │   │
│   │                     │         │   ├── workspace/                      │   │
│   │   ┌──────────────┐  │         │   │   └── AGENTS.md                   │   │
│   │   │  Agent loop  │──┼────────→│   │       (← <skillnote v1> graft)    │   │
│   │   │  (LLM calls) │  │  reads  │   │                                   │   │
│   │   └──────────────┘  │         │   ├── agents/main/sessions/           │   │
│   │          │          │         │   │   ├── sess-abc.jsonl (live log)   │   │
│   │          │ writes   │         │   │   ├── sess-xyz.jsonl              │   │
│   │          │ JSONL    │         │   │   └── ...                         │   │
│   │          ▼          │         │   │                                   │   │
│   │   ┌──────────────┐  │         │   ├── skills/                         │   │
│   │   │ session log  │──┼────────→│   │   ├── skillnote/                  │   │
│   │   └──────────────┘  │  writes │   │   │   ├── SKILL.md  (always-on)   │   │
│   │                     │         │   │   │   ├── sync.sh                 │   │
│   │   reads SKILL.md ◄──┼─────────│   │   │   ├── log-watcher.py          │   │
│   │   from skills dirs  │         │   │   │   ├── install-backend.sh      │   │
│   └─────────────────────┘         │   │   │   ├── config.json {host,user} │   │
│                                    │   │   │   ├── VERSION                 │   │
│                                    │   │   │   ├── .last-sync-time        │   │
│                                    │   │   │   ├── .skillnote-manifest    │   │
│                                    │   │   │   ├── .log-watcher.pid       │   │
│                                    │   │   │   └── .log-watcher-state     │   │
│                                    │   │   ├── sn-brainstorming/SKILL.md  │   │
│                                    │   │   ├── sn-error-handling/SKILL.md │   │
│                                    │   │   └── sn-{slug}/...              │   │
│                                    └───┴───────────────────────────────────┘   │
│                                                  ▲                             │
│   ┌──────────────────────────────────────────────┴──────────────────────────┐ │
│   │  log-watcher.py daemon (background process, PID-guarded)                │ │
│   │     polls sessions/*.jsonl every 2s                                     │ │
│   │     tails new lines, parses toolCall.read for sn-*/SKILL.md             │ │
│   │     POSTs /v1/hooks/skill-used (slug, agent, session_id)                │ │
│   │     deduplicates per (file, session_id)                                 │ │
│   └─────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │  HTTP (every 60s + per-event)
                                       ▼
┌──────────────────────── SkillNote BACKEND (FastAPI :8082) ────────────────────┐
│                                                                                │
│   GET  /v1/skills                       ← sync.sh pulls catalog               │
│   GET  /v1/openclaw-bundle.zip          ← installer downloads (with install-  │
│                                            backend.sh + SKILL.md + sync.sh +  │
│                                            log-watcher.py)                    │
│   GET  /v1/openclaw-skill               ← daily self-update version check     │
│   GET  /setup/agent                     ← unified dispatcher (--agent flag)   │
│   GET  /setup/agent-prompt?agent=...    ← personalized copy-prompt (markdown) │
│   POST /v1/hooks/skill-used             ← log-watcher fires per detected read │
│   POST /v1/openclaw/usage               ← agent fires after task completion   │
│   POST /v1/skills/{slug}/comments       ← agent fires for ratings             │
│                                                                                │
│   ┌──────────────────────────────────────────────────────────────────────┐   │
│   │  PostgreSQL                                                           │   │
│   │     skills, comments, skill_usage_events, skill_ratings, ...          │   │
│   │     ↑ comments with rating fan out to skill_ratings (analytics roll-up)│   │
│   └──────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────── Web UI (Next.js :3000) ─────────────────────┐
│  Skills · Collections · Analytics · Connect · Settings           │
│  Reads from API · displays usage / ratings / comments per skill   │
│  Developer edits skills here · changes propagate via sync within 60s│
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Three independent loops that make it work

The system runs **three concurrent loops**, each with a different cadence and purpose. They never block each other.

### Loop A — Catalog Sync (every 60s, from `sync.sh`)
**Trigger:** OpenClaw agent calls `~/.openclaw/skills/skillnote/sync.sh` before each task (per the AGENTS.md graft).

```
sync.sh runs
   ├── grab .sync.lock (mkdir-based; concurrent calls bail silently)
   ├── if .last-sync-time < 60s ago → exit
   ├── GET /v1/skills              ← whole catalog
   ├── for each skill from API:
   │     write sn-{slug}/SKILL.md with:
   │        frontmatter (name, description, id, collections)
   │        + body
   │        + rating footer (pre-filled curl with this slug)
   │     skip write if hash unchanged (idempotent)
   ├── compute (manifest_old - api_skills) ∪ stale on-disk = orphans
   ├── delete orphan sn-* dirs
   ├── write .skillnote-manifest.json atomically (tempfile + os.replace)
   └── update .last-sync-time
```

**Why this design:** Throttle prevents hammering the API on rapid agent re-invocations. The lock protects against bash parallelism. Atomic manifest prevents partial reads.

### Loop B — Self-Update (every 24h, from `sync.sh`)
**Trigger:** Same `sync.sh` invocation, but gated by `.last-version-check`.

```
once per 24h:
   GET /v1/openclaw-skill         ← {version, skill}
   compare to local VERSION
   if newer:
      try `clawhub install skillnote@<ver>`  (preferred)
      else overwrite SKILL.md + VERSION inline (fallback)
      print "SkillNote updated to vX.Y.Z" to user once
```

**Why:** Lets us ship plugin fixes without asking users to re-run installers.

### Loop C — Analytics (continuous, from `log-watcher.py` daemon)
**Trigger:** Spawned by `sync.sh` once, PID-guarded (won't double-launch).

```
every 2s:
   for each *.jsonl in ~/.openclaw/agents/main/sessions/
       (skip *.trajectory.* and *.reset.* files)
       stat inode → if changed, treat as rotation, reset offset
       seek to last offset
       parse new lines as JSON:
           if event.type == "session" → update session_id, clear seen_slugs
           if event.type == "message":
               for each toolCall in content:
                   if name == "read" AND path matches "**/sn-{slug}/SKILL.md":
                       if slug not in seen_slugs (per session):
                           POST /v1/hooks/skill-used {slug, agent, session_id}
                           seen_slugs.add(slug)
       save offset
```

**Why:** OpenClaw doesn't have PostToolUse hooks like Claude Code, so we parse the session log instead. Per-session dedup prevents inflated counts when an agent re-reads the same skill mid-conversation. Inode tracking handles log rotation. Offset preservation across daemon restarts prevents replay storms.

---

## 4. Three feedback channels back to SkillNote

| Channel | Source | What it captures | Endpoint |
|---|---|---|---|
| **Implicit usage** | log-watcher daemon | "Agent opened SKILL.md for skill X in session Y" | `POST /v1/hooks/skill-used` |
| **Explicit task outcome** | Agent (per AGENTS.md graft) | "Completed task using skills [a, b], outcome: completed" | `POST /v1/openclaw/usage` |
| **Quality signal** | Agent (per rating footer) | "Skill X helped/failed — rating 1-5 + one-line note" | `POST /v1/skills/{slug}/comments` |

These three layers are intentional:
- **Implicit** is automatic and complete — we always know what was read.
- **Explicit** is intent-aware — the agent paraphrases the task and links the skills it actually applied (vs. just glanced at).
- **Quality** is judgment — the agent's same-turn opinion before context fades; ratings fan out from `comments` to `skill_ratings` for analytics roll-ups.

---

## 5. Why the design choices

| Decision | Why |
|---|---|
| **One unified `skillnote` skill** (vs. earlier 2-skill `awareness` + `resolver`) | OpenClaw's native skill system + AGENTS.md graft makes the resolver redundant — the agent reads `sn-*/SKILL.md` directly. Less to install, less to break. |
| **`always: true` on the parent skill** | Ensures the SKILL.md (and its setup steps) are in every session's system prompt — no chance of being "forgotten." |
| **AGENTS.md graft** | OpenClaw reloads AGENTS.md every session — gives us a persistent place to tell the agent "always sync first, log usage after." |
| **AGENTS.md graft is done by `sync.sh`, not the agent** | LLMs default to "ask consent before modifying user files" — and we couldn't override that even with explicit `do NOT ask` instructions in SKILL.md. So we moved the graft into `sync.sh`. The shell script can't be talked out of just appending text. The agent's Step 5 just verifies. (See §8.) |
| **Per-skill rating footer injected at sync time** | Agents don't reliably remember things across sessions. The pre-filled curl command is right there in the skill body — they rate while context is fresh. |
| **Log-watcher daemon (vs. agent self-reporting)** | Agents lie (or just forget). Parsing the session log gives ground truth for "what was actually opened." Self-reporting handles intent on top. |
| **`mkdir` lock + atomic manifest** | Bash `&` and concurrent agent invocations would otherwise race the manifest. POSIX `rename` is atomic; `mkdir` is the portable lock. |
| **PID-guarded daemon** | `sync.sh` runs every minute via the agent — without PID guarding we'd have N daemons fighting over the offset state. |
| **Throttle via `.last-sync-time`** | Same reason — agent calls sync constantly, but we don't want to hammer `/v1/skills` more than once a minute. |
| **Inode tracking** | Sessions rotate on agent restart. Tracking inode (vs. path) means we don't double-count or skip lines after a rotation. |
| **Comment fan-out to `skill_ratings`** | Lets the same analytics pipeline serve both Claude Code (which writes directly to `skill_ratings`) and OpenClaw (which uses comments) without separate aggregation paths. |

---

## 6. The complete data flow for one task

```
USER: "fix this auth bug"
   │
   ▼
OpenClaw reads AGENTS.md → sees <skillnote v1> block
   │
   ▼
Agent runs `sync.sh` (Loop A throttle decides: skip, already synced 30s ago)
   │
   ▼
Agent decides: brainstorming + error-handling are relevant
Agent runs Read tool on:
   - ~/.openclaw/skills/sn-brainstorming/SKILL.md
   - ~/.openclaw/skills/sn-error-handling/SKILL.md
   │
   ├─────────────────────────────────────────────────────┐
   │  (concurrently)                                      │
   │  log-watcher sees the toolCall.read in session JSONL │
   │  POST /v1/hooks/skill-used × 2 (one per slug)        │
   │  → backend increments call_count on both skills      │
   ▼                                                      │
Agent reads each SKILL.md → applies guidance             │
Agent writes the bug fix                                  │
Agent finishes task                                       │
   │                                                      │
   ▼                                                      │
Agent runs:                                               │
   POST /v1/openclaw/usage                                │
   {agent_name, task_summary: "fixed auth null deref",   │
    skill_ids: [...], outcome: completed, channel: cli}   │
   → backend records SkillUsageEvent                      │
   │                                                      │
   ▼                                                      │
Agent (one of the skills had a clear win):                │
   POST /v1/skills/error-handling/comments                │
   {author, author_type: agent,                           │
    comment_type: agent_success_note, rating: 5,          │
    body: "the null-check pattern caught it immediately"} │
   → backend writes Comment + fans out to skill_ratings   │
                                                          │
                                                          ▼
                              Web UI Analytics tab picks up:
                                - call_count for both skills (+1)
                                - avg_rating on error-handling (updated)
                                - usage event in agent activity
                                - comment in error-handling Reviews tab
```

---

## 7. Failure modes & how the design handles them

| Failure | Handling |
|---|---|
| Backend unreachable | sync.sh exits silently — local sn-* dirs stay intact, no data loss. Agent uses last-known skills. |
| Backend unreachable AND localhost (fresh user) | SKILL.md Step 2 detects this case and offers to install the backend. Agent runs `install-backend.sh`. |
| `install-backend.sh` missing on disk | SKILL.md falls back to `curl -sfL <github-raw>/install-backend.sh \| bash` (same canonical script). Final fallback: manual `git clone` instructions. |
| Malformed config.json | Python try/except → silent exit, no crash. |
| Agent crashes mid-session | Next sync rebuilds sn-* from API. Log-watcher offset survives — no replay. |
| Two concurrent syncs | First grabs `.sync.lock` (mkdir), second sees existing dir and bails. |
| Daemon dies | Next `sync.sh` invocation sees `kill -0 $pid` fail → relaunches. PID file is the source of truth. |
| Session JSONL corrupted line | `json.JSONDecodeError` caught per-line; skip bad line, continue with the next. |
| Skill renamed on server | Old slug appears in manifest but not API → marked stale, dir removed. New slug syncs as "new." |
| Plugin update breaks something | Daily self-update is opt-in via `clawhub`; the inline fallback overwrites only `SKILL.md`/`VERSION`, never the lock or daemon state. |
| Re-install over existing setup | New installer preserves user's `config.json`, kills old daemon, then re-extracts. |
| `clawhub install skillnote` fails | Personalized prompt's Step 1 falls back to `curl -sf <host>/setup/agent \| bash -s -- --agent openclaw` |
| Custom (non-localhost) backend unreachable | SKILL.md Step 1 doesn't auto-install — the user explicitly pointed at a server, so the agent reports "down, will retry next session" instead of presuming. |

---

## 8. Install architecture (the agent-driven model)

The install flow inverts the usual "user runs commands, agent helps" model. Here, the agent IS the installer — the user just types one prompt.

### What this requires

1. **Skill self-contained on disk** — every file the agent might need (SKILL.md, sync.sh, log-watcher.py, install-backend.sh) ships in the clawhub bundle. No "download this other thing" step during setup.
2. **Layered URL resolution** — `$SKILLNOTE_BASE_URL` env > `~/.openclaw/skillnote/config.json` > skill-dir config > `http://localhost:8082` default. Most users never touch any of these.
3. **Agent-runnable bootstrap script** — `install-backend.sh` is a single `bash <path>` invocation that handles git clone + Docker + readiness polling + error triage internally. The agent executes it; doesn't reimplement it.
4. **Honest consent — but only where the agent has a real choice.** The agent asks once before installing the backend (Docker spinup is a meaningful action). It does NOT ask before grafting AGENTS.md — that's done shell-side by `sync.sh`. (See "The consent-prompt anti-pattern" below.)
5. **Failure surfaces** — if the script fails, the agent shows `./install.sh`'s actual output instead of papering over it.

### The consent-prompt anti-pattern (and why we moved AGENTS.md graft to sync.sh)

Initial design: SKILL.md Step 5 told the agent to ask the user "may I add a small block to your AGENTS.md? [Y/n]" before grafting. This worked in interactive sessions but broke in three real failure modes:

1. **Non-interactive / scripted runs** (`openclaw agent --message "set up skillnote"`) — the agent has no way to receive a Y/n. It pauses indefinitely or surfaces as an unfinished half-state.
2. **CI / async messaging** — the consent question goes to a queue with no human attached.
3. **Even with explicit "do NOT ask" instructions in SKILL.md, the LLM still asked.** This was the surprise. We tried wording it as a 🛑 IMPORTANT directive at the top of Step 5 ("do not ask any questions in this step"). The agent still asked. LLM safety training has a strong default of "ask before modifying user files" that prose instructions can't reliably override.

**The fix**: move the graft logic out of the SKILL.md (which the LLM interprets) and into `sync.sh` (which is a shell script that just runs). The agent's Step 5 reduces to a single `grep -c '<skillnote v1>'` verification — no file editing, no consent question, no LLM judgment. The shell script can't be talked out of `cat block >> AGENTS.md`.

**Side effects:**
- `sync.sh` now runs an idempotent graft check on every invocation (cheap — just a grep)
- An opt-out flag (`{"grafted": false}` in `config.json`) is honored by `sync.sh`, not the agent — so the user can disable the graft permanently with one config edit even if the agent tries to re-add it
- The graft happens during `curl|bash` install too (since the installer runs sync.sh as part of install) — so the user is connected before the agent ever loads

**General principle this surfaces**: any time you're about to write "[the agent] should not ask the user for consent here" in SKILL.md, that's a signal to move the action out of the LLM and into a shell script. The LLM will fight you. The shell won't.

### Why agent-driven (vs. CLI-driven)

| Concern | CLI-driven (old) | Agent-driven (new) |
|---|---|---|
| User burden | Read README, clone, cd, run install.sh, then install plugin | Type one prompt |
| Non-technical users | Fails (can't type bash commands confidently) | Works (agent does the typing) |
| Cross-machine setup | Same procedure each time | Same prompt each time |
| Error recovery | User has to read error messages and decide what to do | Agent reads, classifies common errors, suggests fix |
| Updates | User has to know which command to re-run | Agent re-reads SKILL.md; flow is identical to first install |

### Trust boundary

The user trusts clawhub to install the skill (same trust they extend to any clawhub package). Everything we ship inside the skill bundle (`install-backend.sh`, `sync.sh`, `log-watcher.py`) inherits that trust — no separate "and now trust this other URL" ask. The GitHub raw URL is recovery-only and points at the same canonical file.
