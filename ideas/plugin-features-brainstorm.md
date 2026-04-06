# SkillNote Plugin — Complete Features Brainstorm

> All ideas from brainstorming sessions on 2026-04-05 and 2026-04-06.
> Status: V1 IMPLEMENTED. Remaining features need prioritization.
> Related: [skill-push-prd.md](./skill-push-prd.md), [skill-sync-hook-prd.md](./skill-sync-hook-prd.md)
>
> V1 shipped (2026-04-06): A1-A3 (setup), B1-B2-B5 (sync), C1 (analytics), E1-E2-E5-E6 (push), H1-H2-H3-H7-H8 (plugin features), J7-J8 (UI)

---

## Context

SkillNote is a self-hosted skill registry for AI coding agents. The plugin delivers SkillNote's full power into Claude Code as a single installable unit — MCP connection, skill sync, analytics, feedback loops, and skill creation — all from one `claude plugin install`.

### Core Problem We're Solving

Skills managed in SkillNote's web UI need to reach Claude Code with:
- Full Claude Code features (allowed-tools, context: fork, effort, model overrides)
- Automatic sync (no manual file management)
- Usage analytics (automatic, not agent-dependent)
- Feedback loops (skills improve over time)
- Seamless multi-project support
- Team distribution with zero friction

### Architecture Decision: Hooks-Primary, MCP-Secondary

Research finding: MCP server failures can crash Claude Code sessions (Issue #18557). SSE transport is deprecated. HTTP transport is more stable but still fragile. Hooks fail gracefully (no output = no action).

**Decision:** Core integration via hooks (sync, analytics, feedback). MCP as optional enhancement (ratings, fallback skill delivery, real-time tools).

---

## Plugin Structure

```
skillnote-plugin/
├── .claude-plugin/
│   └── plugin.json           ← manifest + userConfig
├── .mcp.json                 ← optional MCP server connection
├── settings.json             ← default permissions + env vars
├── hooks/
│   └── hooks.json            ← all hook registrations
├── hooks-handlers/
│   ├── sync.sh               ← SessionStart: skill sync engine
│   ├── track-usage.sh        ← PostToolUse[Skill]: usage analytics
│   ├── session-eval.sh       ← Stop: process Haiku feedback
│   └── worktree-setup.sh     ← WorktreeCreate: copy skills
├── skills/
│   └── skill-push/
│       └── SKILL.md          ← quick-capture skill creation
├── agents/
│   └── skill-creator.md      ← deep skill creation agent
├── commands/
│   ├── skillnote-browse.md   ← /skillnote-browse
│   ├── skillnote-stats.md    ← /skillnote-stats
│   └── skillnote-sync.md     ← /skillnote-sync (manual trigger)
├── output-styles/
│   └── skill-citation.md     ← cite which skills guided decisions
├── bin/
│   └── skillnote-sync        ← CLI tool in Bash PATH
└── README.md
```

---

## Feature Categories

### A. Setup & Installation

#### A1. One-Command Install
```bash
claude plugin install https://github.com/luna-prompts/skillnote-plugin --scope user
```
Claude Code prompts for `host` via `userConfig`. Everything auto-configures. Works in every project.

#### A2. userConfig — Install-Time Prompts
```json
"userConfig": {
  "host": {
    "description": "SkillNote server (e.g., <your-server-ip> or localhost)",
    "sensitive": false
  }
}
```
Stored in settings. Available as `${user_config.host}` in configs and `CLAUDE_PLUGIN_OPTION_HOST` env var in all scripts.

#### A3. Fallback: curl | bash
For environments where `claude plugin install` doesn't work:
```bash
curl -sf http://<your-server-ip>:8082/setup | bash
```
Creates the plugin directory structure and registers it manually.

#### A4. Team Auto-Install via Marketplace
Commit to `.claude/settings.json` in any repo:
```json
{
  "extraKnownMarketplaces": {
    "skillnote": {
      "source": { "source": "github", "repo": "luna-prompts/skillnote-plugin" }
    }
  },
  "enabledPlugins": { "skillnote@skillnote": true }
}
```
Teammates clone → prompted to install → enter host → done.

#### A5. Organization Lockdown
IT/admins can enforce SkillNote as the only skill source:
```json
// managed-settings.json
{
  "strictKnownMarketplaces": [
    { "source": "github", "repo": "our-org/skillnote-plugin" }
  ]
}
```

#### A6. Plugin Default Settings
Ship `settings.json` with the plugin:
```json
{
  "env": {
    "SKILLNOTE_URL": "http://localhost:8082"
  }
}
```
Pre-configures sensible defaults. User's `userConfig` overrides.

#### A7. GET /setup Endpoint
Self-referencing setup script served by SkillNote. Derives MCP/Web URLs from request origin. Creates plugin directory, registers it, runs first sync.

#### A8. GET /v1/config Endpoint
Returns all service URLs for discovery:
```json
{"api_url": "...", "mcp_url": "...", "web_url": "..."}
```

---

### B. Skill Sync

#### B1. SessionStart Sync Hook
The core sync engine. Runs on every session start:
- Curls `GET /v1/skills` from SkillNote API
- Writes `~/.claude/skills/{slug}/SKILL.md` with full frontmatter
- Manages manifest for create/update/delete tracking
- Injects `additionalContext` about what changed

```json
"SessionStart": [{
  "matcher": "startup|resume|compact",
  "hooks": [{
    "type": "command",
    "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks-handlers/sync.sh\"",
    "timeout": 15,
    "statusMessage": "SkillNote: syncing skills..."
  }]
}]
```

Key: `startup|resume|compact` matcher ensures context survives compaction.

#### B2. Manifest-Based Sync (Create/Update/Delete)
Manifest at `${CLAUDE_PLUGIN_DATA}/manifest.json` tracks managed skills:
- In API + not local → create
- In API + changed → overwrite
- In manifest + NOT in API → delete (skill removed from registry)
- NOT in manifest → don't touch (user's own skill)

#### B3. Session Context Injection
After sync, inject into Claude's context:
```
SkillNote: 12 skills synced. 2 updated: error-handling (v4), deploy-checklist (v2). 
1 new: use-pnpm. Skill 'use-zod-validation' has a suggested improvement.
```
Claude starts every session knowing what's available and what changed.

#### B4. Offline-First with Persistent Cache
`${CLAUDE_PLUGIN_DATA}/skill-cache/` stores last-synced skill content. If SkillNote API unreachable, sync falls back to cached versions. Skills always work offline.

#### B5. Per-Project Scoping via `.skillnote.json`
Optional config file in project root (committed to git):
```json
{"collections": ["frontend", "conventions"]}
```
- If present: sync filtered collections → `.claude/skills/` (project-level)
- If absent: sync all → `~/.claude/skills/` (global)
- `{"collections": []}` → opt out entirely for this project
- `{"collections": "*"}` → all skills, project-scoped

#### B6. FileChanged Hook for Instant Re-Sync
```json
"FileChanged": [{
  "matcher": ".skillnote.json",
  "hooks": [{
    "type": "command",
    "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks-handlers/sync.sh\"",
    "statusMessage": "SkillNote: re-syncing..."
  }]
}]
```
Edit `.skillnote.json` → skills re-sync immediately. No restart.

#### B7. WorktreeCreate Hook
When Claude creates a git worktree for isolated work, copy active skills and `.skillnote.json` into the worktree so skills are available from the first prompt.

#### B8. `!`curl...`` Live-Fetch Pattern
Skills can fetch latest content at invocation time:
```markdown
!`curl -s http://localhost:8082/v1/skills/my-skill/raw`
```
Every invocation gets the latest version without needing a full sync. Optional — for skills that change frequently.

#### B9. Token Budget Awareness
Follow superpowers' pattern: inject only a master "dispatch" skill via SessionStart. All other skills are lazy-loaded via the Skill tool. This prevents overwhelming the ~15K description budget.

#### B10. Project Stack Auto-Detection
SessionStart hook reads `package.json`, `tsconfig.json`, `requirements.txt`, etc.:
```bash
if [ -f package.json ]; then
  DEPS=$(node -e "const p=require('./package.json'); console.log(Object.keys({...p.dependencies,...p.devDependencies}).join(','))")
  # Fetch relevant skills based on detected stack
  curl -sf "$API/v1/skills/recommend?stack=$DEPS"
fi
```
Suggests relevant skills based on project technology.

#### B11. InstructionsLoaded Hook
When CLAUDE.md loads (at session start or mid-session during nested traversal):
```json
"InstructionsLoaded": [{
  "hooks": [{
    "type": "command",
    "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks-handlers/augment-instructions.sh\""
  }]
}]
```
Injects: "SkillNote skills available for this project: [list]. Use /skill-name to activate."

#### B12. PreCompact Survival Strategy
Two-layer approach:
1. SessionStart matcher includes `compact` → re-injects skill context after every compaction
2. Write active skills as `.claude/rules/skillnote-active.md` — CLAUDE.md/rules files reload fresh from disk after compaction

---

### C. Analytics & Usage Tracking

#### C1. PostToolUse[Skill] — Automatic Usage Tracking
```json
"PostToolUse": [{
  "matcher": "Skill",
  "hooks": [{
    "type": "command",
    "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks-handlers/track-usage.sh\"",
    "async": true
  }]
}]
```
Every skill invocation automatically POSTs to `POST /v1/hooks/skill-used`. No agent cooperation needed. Async (non-blocking).

#### C2. SubagentStop Hook — Track Subagent Skill Usage
```json
"SubagentStop": [{
  "hooks": [{
    "type": "command",
    "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks-handlers/track-subagent.sh\"",
    "async": true
  }]
}]
```
Posts `agent_type`, `agent_id`, and skill usage data. Powers "most used skills in subagent contexts" analytics.

#### C3. Session-Level Analytics
SessionStart hook reports session metadata (project path, detected stack, installed skills count). Stop hook reports session duration and skill invocation count. All async POSTs to SkillNote.

#### C4. Token Cost Badge
Every skill gets an estimated context cost (chars/4 ≈ tokens). Shown in web UI:
- Green: <500 tokens (tiny)
- Yellow: 500-2000 tokens (medium)
- Red: >2000 tokens (large)

The sync script calculates and caches this. SessionStart context includes budget summary.

#### C5. Skill Effectiveness Score (SES)
Composite metric replacing raw star ratings:

| Component | Weight | Source |
|-----------|--------|--------|
| Usage frequency | 25% | PostToolUse hook |
| Explicit ratings | 25% | complete_skill MCP |
| Auto-eval (Haiku) | 20% | Stop prompt hook |
| Version activity | 15% | Content version history |
| Token efficiency | 15% | Token cost vs rating ratio |

API: `GET /v1/skills/{slug}/effectiveness`

#### C6. Skill Health Dashboard (Web UI)
Per-skill analytics page:
- Invocations over time (sparkline)
- Active vs abandoned installs
- Version adoption curve
- Most common failure patterns (from traces)
- Team/agent distribution

---

### D. Feedback & Ratings

#### D1. Three-Layer Feedback System

| Layer | Mechanism | User Effort | Signal |
|-------|-----------|-------------|--------|
| Usage tracking | PostToolUse hook | Zero | Quantity |
| Smart evaluation | Stop prompt hook (Haiku) | Zero | Quality |
| Explicit rating | complete_skill MCP | Agent rates | Quality + outcome |

#### D2. Stop Hook — Haiku Auto-Evaluation
```json
"Stop": [{
  "hooks": [{
    "type": "prompt",
    "prompt": "Review this session briefly. 1) Were any invoked skills unhelpful or wrong? Name them. 2) Were there repeated instructions that could become a skill? Name the pattern. If neither, say 'none'. Be concise.",
    "model": "haiku",
    "timeout": 10
  }]
}]
```
At every session end, Haiku silently evaluates skill quality and detects patterns. Zero user effort.

#### D3. Session Eval Processing
A second Stop hook (command type) processes Haiku's evaluation:
- Posts negative feedback to `POST /v1/hooks/session-eval`
- Posts detected patterns to `POST /v1/hooks/pattern-detected`
- SkillNote aggregates across sessions

#### D4. Explicit Ratings via MCP
The existing `complete_skill` MCP tool continues to work. Agents call it after using a skill. This supplements (not replaces) the automatic feedback.

#### D5. AI-Powered Improvement Suggestions
When a skill accumulates negative feedback:
1. Collect: SKILL.md + all feedback + failure traces
2. Send to LLM: "Propose specific improvements as a diff"
3. Show in web UI as a "Suggested Improvement" card
4. Author can accept/reject/edit with one click

API: `POST /v1/skills/{slug}/suggest-improvement`

#### D6. Trace-Based Skill Evolution
Users can submit "this worked" / "this failed" + session excerpt. Over time, builds a training set. "Skill Evolution" button analyzes traces and proposes a new version. Based on Trace2Skill research (arxiv 2603.25158).

#### D7. A/B Experiment Mode
Test two skill versions against the same prompt set:
1. User defines test prompts
2. System runs both versions
3. Side-by-side comparison with thumbs up/down
4. Aggregate results auto-promote the winner

#### D8. Feedback Flywheel
```
Skill created → agents use it (tracked) → Haiku evaluates (automatic) 
→ negative signals aggregate → AI suggests improvement → author applies 
→ new version synced → usage improves → cycle repeats
```
No human needs to explicitly "rate" anything. The system learns from usage.

---

### E. Skill Creation & Push

#### E1. skill-push Skill (Quick Capture)
Ships with the plugin. Guides agents through:
1. Confirm pattern with user
2. Draft name + description (with trigger keywords) + content
3. Fetch available collections (curl API)
4. User picks collection
5. Show final preview
6. Push via Python urllib (handles JSON escaping)

Uses `{{API_URL}}` and `{{WEB_URL}}` placeholders, substituted by MCP server at runtime.

#### E2. skill-creator Agent (Deep Creation)
```yaml
---
name: skill-creator
description: Create, refine, and push skills. Use when patterns detected or user requests.
model: inherit
effort: high
memory: project
tools: [Read, Write, Bash, Grep, Glob, Agent]
---
```
More powerful than a skill:
- `memory: project` — learns preferences across sessions
- `effort: high` — thinks carefully
- Can spawn sub-agents for parallel work

#### E3. Session-End Pattern Detection
The Stop prompt hook detects patterns the user might not notice:
```
SkillNote: Pattern detected — user prefers early returns over nested ifs.
Consider creating a skill with /skillnote:skill-creator
```

#### E4. Skill Linting on Push
Automated checks when a skill is created:
- Token cost estimate → badge color
- Description trigger quality → warning if vague
- Content length → warning if >500 lines
- Duplicate detection → block if too similar to existing
- Security scan → block exfiltration patterns, sudo, eval
- Frontmatter completeness → suggest missing fields

#### E5. GET /v1/collections Endpoint
Returns collection names + skill counts for the push flow:
```json
[{"name": "conventions", "count": 8}, {"name": "frontend", "count": 12}]
```

#### E6. Upsert via GET-then-POST/PATCH
No API changes needed. Skill-push checks if slug exists:
- 404 → POST /v1/skills (create)
- 200 → PATCH /v1/skills/{slug} (update, creates new content version)

#### E7. Skill Dependencies
New frontmatter field:
```yaml
requires: [deploy-checklist, run-tests]
```
The sync script resolves dependencies. The web UI shows a dependency graph.

---

### F. Plugin Commands

#### F1. /skillnote-browse
List available skills filtered by current project tags. Shows name, description, effectiveness score, token cost.

#### F2. /skillnote-stats
Usage analytics: most-invoked skills, never-used skills, top contributors, effectiveness leaderboard.

#### F3. /skillnote-sync
Manual sync trigger. Shows what changed. Useful for debugging or forcing an update mid-session.

#### F4. /skillnote-search <query>
Semantic search against SkillNote API. Returns ranked skill suggestions. Uses the description + content for matching.

#### F5. /skillnote-publish
Package and publish the current working skill to the team registry. Guided workflow.

---

### G. Output Styles

#### G1. skill-citation Style
```markdown
---
name: SkillNote Citation
description: Claude cites which skills guided each decision
keep-coding-instructions: true
---

When a SkillNote skill influences your response, cite it:
  "Using skill `commit-conventions` (v1.2) from SkillNote"
```
Makes skill usage visible. Useful for team visibility and debugging.

#### G2. skill-teach Style
When a skill is used, explains what the skill does and why it applies. Useful for onboarding new team members to the team's codified knowledge.

---

### H. Advanced Plugin Features

#### H1. MCP Connection (Optional Enhancement)
```json
// .mcp.json
{
  "mcpServers": {
    "skillnote": {
      "type": "http",
      "url": "http://${user_config.host}:8083/mcp"
    }
  }
}
```
Used for: `complete_skill` (explicit ratings), fallback skill delivery for unsynced skills, real-time tool discovery.

#### H2. bin/ CLI Tools
`bin/skillnote-sync` — available as bare command in Bash:
```bash
skillnote-sync              # manual sync
skillnote-sync --status     # show sync state  
skillnote-sync --force      # force re-sync all
```

#### H3. Persistent Storage
```
${CLAUDE_PLUGIN_DATA}/          (~/.claude/plugins/data/skillnote/)
├── skill-cache/                ← cached skill content (offline)
├── manifest.json               ← sync state
├── effectiveness-cache.json    ← cached scores
└── last-sync.txt               ← timestamp
```
Survives plugin updates. Deleted on uninstall (with confirmation).

#### H4. Channels Plugin (Push Notifications)
An MCP channel that pushes events into running sessions:
- New skill version published → "Skill `git-commit` v1.3 available — update?"
- Skill you authored gets a review → notification in active session
- Security alert on a skill → immediate warning

#### H5. Extra Frontmatter Storage
`extra_frontmatter` TEXT column on the skills table:
```
allowed-tools: Read Write Grep
context: fork
effort: high
```
Stored as raw YAML lines. The sync script includes these in the local SKILL.md frontmatter.

#### H6. {{API_URL}} / {{WEB_URL}} Substitution
MCP server replaces placeholders in skill content at serve time:
```python
api_url = os.environ.get("SKILLNOTE_API_URL", "http://localhost:8082")
content = skill["content_md"].replace("{{API_URL}}", api_url)
```

#### H7. skill_push_enabled Setting
```python
_VALID_SETTINGS["skill_push_enabled"] = {"true", "false"}
```
Controls whether the skill-push skill appears in MCP tool list. Default: true.

#### H8. Seed skill-push.md
The skill-push skill is seeded by default in SkillNote. Available via MCP and synced locally.

---

### I. Backend Endpoints (New)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/setup` | GET | Serves the curl\|bash install script |
| `/v1/config` | GET | Returns API/MCP/Web URLs |
| `/v1/collections` | GET | Collection names + counts |
| `/v1/hooks/skill-used` | POST | Receives PostToolUse analytics |
| `/v1/hooks/session-eval` | POST | Receives Haiku evaluation results |
| `/v1/hooks/pattern-detected` | POST | Receives pattern detection signals |
| `/v1/skills/{slug}/effectiveness` | GET | Composite effectiveness score |
| `/v1/skills/{slug}/suggest-improvement` | POST | AI-generated improvement proposal |
| `/v1/skills/recommend` | GET | Recommend skills based on stack |
| `/v1/hooks/sync-script` | GET | Serves the sync script (for manual setup) |

---

### J. Web UI Enhancements

#### J1. Effectiveness Score Display
Replace raw star ratings with composite score. Sparkline of score over time.

#### J2. Token Cost Badge
Shown on every skill card. Color-coded. Calculated on save.

#### J3. Suggested Improvement Cards
When AI generates an improvement, show as a diff card on the skill detail page. Accept/reject/edit.

#### J4. Dependency Graph View
Visual graph of skill dependencies. Which skills are standalone, which need others.

#### J5. Skill Health Dashboard
Per-skill: invocations over time, version adoption, failure patterns, agent distribution.

#### J6. Advanced Metadata Editor
In skill editor, expandable section for `extra_frontmatter`:
```
[v] Advanced Metadata (Claude Code features)
  allowed-tools:  [Read Write Grep        ]
  context:        [fork          v]
  effort:         [high          v]
```

#### J7. Integration Page — Plugin Setup
Show plugin install command with copy button. Show per-collection `.skillnote.json` snippets. Show active connections from the plugin's hook analytics.

#### J8. Settings — New Toggles
- "Allow agents to create skills" (skill_push_enabled)
- Informational: "Plugin sync enabled" (read from hook analytics data)

#### J9. Sandbox Preview
Lightweight playground in browser where users type a sample prompt and see how the skill would instruct the agent. No install needed to understand what a skill does.

#### J10. Usage Attribution
Which team member's skills have highest adoption? Leaderboard for skill authors.

---

### K. Team & Distribution

#### K1. Private Marketplace
GitHub repo with `marketplace.json` pointing to the plugin. Team members get auto-prompted to install.

#### K2. Organization Lockdown
`strictKnownMarketplaces` in managed settings locks to approved sources.

#### K3. Scope Precedence
Project-scope plugin config overrides user-scope. Team can enforce a specific SkillNote URL.

#### K4. Skill Divergence Detection
Alert when a team member's installed skill version differs from the org-approved version.

#### K5. Skill Review Workflow
Propose a skill → team reviews in web UI → approved for org install.

---

### L. Security & Trust

#### L1. Skill Linting (See E4)
Automated static analysis on upload.

#### L2. Permission Scope Declaration
Skills declare what tools they need in `extra_frontmatter`. Synced locally with `allowed-tools`.

#### L3. Verification Badge
Skills that pass automated audit get a badge in the web UI.

#### L4. Security Scan Patterns
Check for: base64 obfuscation, exfiltration URLs, sudo/eval, prompt injection patterns.

---

### M. Offline & Resilience

#### M1. Offline-First Sync (See B4)
Cache in `${CLAUDE_PLUGIN_DATA}`. Graceful fallback.

#### M2. No-MCP Mode
Plugin works without MCP. Skills + hooks are sufficient for core functionality. MCP is an optional enhancement.

#### M3. Graceful Degradation
Every hook exits 0 on failure. No hook failure blocks Claude Code. API unreachable → use cached skills.

---

### N. Discovered Patterns (From Other Plugins)

#### N1. Superpowers Budget Pattern
Inject only ONE master skill via SessionStart. All others lazy-load via Skill tool. Prevents description budget overflow.

#### N2. Hookify Dynamic Config Pattern
`.claude/hookify.*.local.md` files = per-project config, no restart needed. SkillNote equivalent: `.skillnote.json` watched by FileChanged hook.

#### N3. Ralph-Wiggum Loop Pattern
Stop hook with `decision: block` re-feeds prompts. Could be used for iterative skill improvement sessions.

#### N4. Security-Guidance Session State
Per-session state file keyed by `session_id`. Deduplication within a session. Cleanup of stale files.

#### N5. Feature-Dev Multi-Agent Pattern
Parallel subagent spawning → aggregate → gate on user approval. Applicable to skill creation (parallel drafting of name/description/content by different agents).

#### N6. Skill-Creator Eval Loop
A/B testing: spawn agent WITH skill vs WITHOUT skill. Grade outputs. Iterate. The gold standard for skill quality.

---

## Research Sources

### Community Data
- GitHub Copilot removed 27 tools (40→13), accuracy improved — [GitHub Blog](https://github.blog/ai-and-ml/github-copilot/how-were-making-github-copilot-smarter-with-fewer-tools/)
- Tool accuracy: 95% → 71% at 46 tools — [Dev.to benchmark](https://dev.to/nebulagg/mcp-tool-overload-why-more-tools-make-your-agent-worse-5a49)
- CLI uses 68% fewer tokens than MCP — [bswen.com](https://docs.bswen.com/blog/2026-04-03-mcp-vs-cli-claude-code/)
- Skills activation rate: 20% baseline → 72-90% with trigger keywords — [mellanon gist](https://gist.github.com/mellanon/50816550ecb5f3b239aa77eef7b8ed8d)
- Description truncated to ~250 chars in skill listings — [alexey-pelykh gist](https://gist.github.com/alexey-pelykh/faa3c304f731d6a962efc5fa2a43abe1)
- `tools/list_changed` notification broken — [Issue #13646](https://github.com/anthropics/claude-code/issues/13646)
- Heredoc permission matching bug — [Issue #25441](https://github.com/anthropics/claude-code/issues/25441)
- MCP crashes on SSE disconnect — [Issue #18557](https://github.com/anthropics/claude-code/issues/18557)
- `curl` is in Claude Code's default blocklist — [Skill best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- Trace2Skill: 35B model skills improved 122B model by 57.65pp — [arxiv 2603.25158](https://arxiv.org/abs/2603.25158)
- 36% of community skills have security issues — [SkillTester arxiv 2603.28815](https://arxiv.org/html/2603.28815)

### Official Docs
- [Skills docs](https://code.claude.com/docs/en/skills)
- [Hooks reference](https://code.claude.com/docs/en/hooks)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Output styles](https://code.claude.com/docs/en/output-styles)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Channels reference](https://code.claude.com/docs/en/channels-reference)
- [Settings](https://code.claude.com/docs/en/settings)
- [MCP docs](https://code.claude.com/docs/en/mcp)

### Plugin Examples Studied
- `superpowers` v4.3.1 — budget management, master skill injection, multi-skill lazy loading
- `hookify` — dynamic .local.md config, runtime rule evaluation
- `ralph-wiggum` — Stop hook loop pattern, transcript parsing
- `code-review` — multi-agent orchestration (Haiku gates, Sonnet summary, Opus deep analysis)
- `security-guidance` — PreToolUse monitoring, session-id state files
- `feature-dev` — 7-phase parallel subagent workflow
- `skill-creator` — eval loop, A/B testing, description optimization
- `learning-output-style` — SessionStart context injection
- `episodic-memory` — MCP-based semantic search across sessions
