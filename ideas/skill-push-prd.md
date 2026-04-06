# PRD: Skill Push — Agent-Driven Skill Creation & Registry Push

> Status: IMPLEMENTED (PR1-PR4, 2026-04-06)
> Date: 2026-04-05 (brainstorm) / 2026-04-06 (implemented)
> Author: Rudra Naik + Claude Code
>
> Implementation notes:
> - Skill-push seed: `backend/scripts/seeds/skill-push.md`
> - MCP URL substitution: `{{API_URL}}` / `{{WEB_URL}}` replaced at serve time
> - Setting: `skill_push_enabled` (default true) controls visibility
> - Collections endpoint: `GET /v1/collections` for the push flow
> - Hooks endpoint: `POST /v1/hooks/skill-used` for analytics
> - Extra frontmatter: `extra_frontmatter` column added to skills table
> - Plugin: ships skill-push as local skill + skill-creator agent
> - 9 bugs found and fixed during implementation

---

## Problem

SkillNote lets agents consume skills (via MCP) and rate them (via `complete_skill`), but there is no way for agents to **contribute skills back**. The feedback loop is one-way. When a user repeatedly gives the same coding convention or instruction across sessions, that knowledge dies with the conversation instead of becoming a reusable skill.

## Solution

A single default skill (`skill-push`) served via MCP that:

1. **Observes** repeated instructions/conventions in the conversation
2. **Guides** the agent through drafting a skill collaboratively with the user
3. **Pushes** the finalized skill to the SkillNote registry via the REST API

No new MCP tools. No new DB models. One seed skill, one setting, one lightweight endpoint.

---

## Architecture

```
skill-push (MCP skill)                    SkillNote REST API
  "Detects & guides"                       POST /v1/skills
        |                                  PATCH /v1/skills/{slug}
        v                                  GET /v1/collections
Agent detects pattern                           ^
  -> calls skill-push                           |
  -> gets instructions back                     |
  -> follows the guide:                         |
    1. Confirm with user                        |
    2. Draft skill collaboratively              |
    3. Fetch collections (Python urllib)         |
    4. User picks collection                    |
    5. Show final preview                       |
    6. User approves -------> Python script --> POST/PATCH
                                                |
                                                v
                                         Skill is live
                                         pg_notify -> all agents see it
```

### Why a Skill, Not an MCP Tool

Research-backed decision. Community data overwhelmingly supports fewer MCP tools:

- Tool selection accuracy drops from **95% -> 71%** going from 4 to 46 tools (Dev.to benchmark)
- GitHub Copilot **removed 27 tools** (40->13), accuracy went UP (GitHub Engineering)
- CLI/curl uses **68% fewer tokens** than equivalent MCP operations (bswen.com)
- Claude Code official docs: *"prefer CLI tools, they don't add persistent definitions"*
- Skills load progressively — near zero context cost until triggered

`push_skill` as a permanent MCP tool would tax every session's context for an action that happens maybe once every 10-50 sessions. A skill costs zero tokens until invoked.

### Why Python, Not curl

Research uncovered critical issues with curl inside skills:

1. **`curl` is in Claude Code's default command blocklist** — requires explicit `allowed-tools: "Bash(curl *)"` to bypass
2. **`allowed-tools` only works for locally-installed skills** — has NO effect when served via MCP (our case)
3. **Heredoc/multiline curl has a permission-matching bug** in Claude Code (Issues #25441, #25909) — `Bash(curl *)` may not auto-approve multiline commands
4. **JSON escaping of markdown content breaks naive curl** — content with quotes, backslashes, newlines, backticks, and YAML `---` markers corrupts raw string interpolation

Python's `urllib.request` (standard library) solves all of these:
- `json.dumps()` handles all escaping perfectly
- No curl blocklist issues
- No heredoc permission bugs
- Available on virtually every dev machine

---

## The Skill: `skill-push`

### Frontmatter

```yaml
---
name: skill-push
description: Create and push reusable skills to SkillNote when repeated instructions are detected or user says "create a skill", "save this pattern", "push a skill". Guides drafting, review, collection selection, and publishing to the registry.
---
```

**Description design notes:**
- Under 250 chars (Claude truncates in skill listings)
- Trigger keywords front-loaded in first 130 chars
- Third-person voice (Anthropic guidance — first/second person breaks coherence)
- Activation rates: 20% (no optimization) -> 72-90% (with trigger keywords) per community data

### Body — The Complete Flow

The skill body guides the agent through these steps:

#### Step 1: Confirm the Pattern

Agent tells user what it noticed. Specific about the pattern and frequency. Asks: "Want me to create a skill for this?" Only acts on persistent conventions, not temporary workarounds.

#### Step 2: Draft the Skill

Three fields:

| Field | Constraints | Notes |
|-------|-------------|-------|
| `name` | `^[a-z0-9-]+$`, max 64 chars, no "anthropic"/"claude" | Also used as `slug` (must be identical) |
| `description` | Max 1024 chars, no XML tags, non-empty | **This is the trigger mechanism.** Must include what the skill does + explicit trigger keywords. Agents decide whether to use a skill based solely on its description. |
| `content_md` | No constraints (unlimited TEXT in DB) | Aim for under 500 lines per Anthropic guidance. Actionable, with correct/incorrect examples. |

Agent shows the full draft to the user.

#### Step 3: Check for Existing Skill

Python script to `GET /v1/skills/{slug}`:
- 404 -> new skill, proceed to create
- 200 -> exists, offer to update (creates new content version via PATCH)

#### Step 4: Choose a Collection

Fetch available collections via `GET /v1/collections` (new endpoint). Present to user:
- Existing collections with skill counts
- Option to create a new collection (just a name)
- Option for no collection (global) — with warning that collection-filtered MCP agents won't see global skills

#### Step 5: Final Review

Show complete preview including how it will appear to other agents. Emphasize: "Does the description have good trigger keywords?" Wait for explicit approval.

#### Step 6: Push

Python script using `urllib.request`:

- **New skill**: `POST /v1/skills` with `name`, `slug`, `description`, `content_md`, `collections`
- **Existing skill**: `PATCH /v1/skills/{slug}` with updated fields (creates new content version)
- On success: show link to web UI, note that agents see it in next session
- On error: show error, help fix (422 = validation, 409 = duplicate, connection refused = API down)

#### Batch Mode

If multiple patterns detected, present as numbered list. User picks which ones to create. Each goes through Steps 2-6.

#### Skill Improvement

If user's instruction contradicts an existing skill, suggest updating it rather than creating a new one. Uses the PATCH path.

---

## Backend Changes

### 1. `{{API_URL}}` / `{{WEB_URL}}` Substitution

**File:** `backend/mcp_server.py` — `_to_tool()` method

The MCP server replaces placeholders when serving skill content at runtime:

```python
api_url = os.environ.get("SKILLNOTE_API_URL", "http://localhost:8082")
web_url = os.environ.get("SKILLNOTE_WEB_URL", "http://localhost:3000")
content = skill["content_md"].replace("{{API_URL}}", api_url).replace("{{WEB_URL}}", web_url)
```

This lets the skill body reference `{{API_URL}}` and `{{WEB_URL}}` as portable placeholders.

### 2. `skill_push_enabled` Setting

**File:** `backend/app/api/settings.py`

Add to the allowlist:

```python
_VALID_SETTINGS: dict[str, set[str]] = {
    "complete_skill_enabled": {"true", "false"},
    "complete_skill_outcome_enabled": {"true", "false"},
    "skill_push_enabled": {"true", "false"},       # NEW
}
```

**File:** `backend/mcp_server.py`

Add to defaults:

```python
_SETTINGS_DEFAULTS = {
    "complete_skill_enabled": "true",
    "complete_skill_outcome_enabled": "false",
    "skill_push_enabled": "true",                   # NEW — on by default
}
```

### 3. Filter `skill-push` When Disabled

**File:** `backend/mcp_server.py` ��� `_list_tools()` and `_get_tool()`

Mirror the `complete_skill` conditional pattern:

```python
# In _list_tools():
if settings.get("skill_push_enabled", "true") != "true":
    tools = [t for t in tools if t.name != "skill-push"]

# In _get_tool():
if name == "skill-push" and settings.get("skill_push_enabled", "true") != "true":
    return None
```

### 4. `GET /v1/collections` Endpoint

**File:** new `backend/app/api/collections.py` or added to `skills.py`

```sql
SELECT unnest(collections) AS name, COUNT(*) AS count
FROM skills
WHERE collections IS NOT NULL AND collections != '{}'
GROUP BY name
ORDER BY name
```

Returns:

```json
[
  {"name": "conventions", "count": 8},
  {"name": "devops", "count": 3},
  {"name": "frontend", "count": 12}
]
```

**No migration needed** — uses `unnest()` on existing `ARRAY(Text)` column.

### 5. Seed File

**File:** `backend/scripts/seeds/skill-push.md`

Contains the full SKILL.md with single-line description (seed parser limitation — naive `split(":", 1)` can't handle multiline YAML).

### 6. Seed Loading

**File:** `backend/scripts/seed_data.py`

Add stanza in `main()` following the `skill-creator` pattern:

```python
skill_push_path = SEEDS_DIR / "skill-push.md"
if skill_push_path.exists():
    raw = skill_push_path.read_text()
    fm, body = parse_frontmatter(raw)
    seed_skill(db, slug="skill-push", name="skill-push",
               description=fm.get("description", "..."),
               content_md=body, collections=[])
```

### 7. Settings UI Toggle

**File:** `src/app/(app)/settings/page.tsx`

One new toggle: **"Allow agents to create skills"** (`skill_push_enabled`)

When off: `skill-push` hidden from MCP tool list. The REST API remains open (no auth), but agents won't be guided to use it.

### 8. Test Updates

**File:** `backend/tests/unit/test_settings_api.py`

Update assertion: `assert len(valid) == 3` (was 2).

---

## Change Summary

| Change | File | Lines |
|--------|------|-------|
| `{{API_URL}}` / `{{WEB_URL}}` substitution in `_to_tool()` | `mcp_server.py` | ~2 |
| `skill_push_enabled` in settings allowlist | `settings.py` | ~1 |
| `skill_push_enabled` in MCP defaults | `mcp_server.py` | ~1 |
| Filter skill-push when disabled | `mcp_server.py` | ~6 |
| `GET /v1/collections` endpoint | `collections.py` or `skills.py` | ~15 |
| `skill-push.md` seed file | `backend/scripts/seeds/` | ~150 |
| Seed loading stanza | `seed_data.py` | ~10 |
| Settings UI toggle | `settings/page.tsx` | ~20 |
| Test fix | `test_settings_api.py` | ~1 |

**No migrations. No new MCP tools. No new DB models.**

---

## User Flow Examples

### Organic Detection

```
User:  "Use pnpm, not npm"
...20 minutes later...
User:  "No, pnpm not npm"
...later...
User:  "We use pnpm here"

Claude: "I've noticed you've corrected me about pnpm 3 times this 
         session. Want me to create a skill so every agent knows 
         this automatically?"

User:  "yes"

Claude: "Here's my draft:

         Name: use-pnpm
         Description: Always use pnpm instead of npm for package 
           management. Trigger when: npm install, npm run, npm ci, 
           package manager, install dependencies.

         # Use pnpm
         This project uses pnpm exclusively. Never use npm or yarn.
         - `pnpm install` not `npm install`
         - `pnpm run dev` not `npm run dev`
         - `pnpm add <pkg>` not `npm install <pkg>`

         Available collections:
           - conventions (8 skills)
           - devops (3 skills)
         
         I'd suggest 'conventions'. Ready to push?"

User:  "push it"

Claude: *runs Python script* 
       "Done! 'use-pnpm' is live at http://host:3000/skills/use-pnpm.
        All connected agents will see it in their next session."
```

### Explicit Request

```
User:  "create a skill for our API error format"

Claude: *calls skill-push, gets instructions*
       "Let me draft that. What should the convention be?"

User:  "All errors return {error: {code, message}} format"

Claude: "Here's the draft:
         Name: api-error-format
         Description: ..."

...same review/push flow...
```

### Batch Detection

```
Claude: "I noticed 3 patterns this session:
         1. Always use TypeScript strict mode (mentioned twice)
         2. Prefer async/await over .then() (corrected once)
         3. Use Zod for all API validation (mentioned 3 times)
         
         Want me to create skills for any of these?"

User:  "1 and 3"

Claude: *processes both through the full flow*
```

### Updating an Existing Skill

```
Claude: "The 'error-handling' skill says to use try/catch, but 
         you've been telling me to use Result types. Want me to 
         update it?"

User:  "yes, update it"

Claude: *fetches current skill, shows diff, user approves*
       *PATCHes -> new content version created*
       "Updated 'error-handling' to v4."
```

---

## Design Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Skill vs MCP tool | **Skill** | Zero context overhead until triggered; push is infrequent; community data: fewer tools = better accuracy |
| curl vs Python | **Python `urllib.request`** | curl is blocklisted by default; `allowed-tools` doesn't work via MCP; heredoc permission bug; `json.dumps` handles all escaping |
| Draft in DB vs conversation | **Conversation** | Simpler; the review IS the conversation; no draft lifecycle needed |
| `allowed-tools` frontmatter | **Removed** | Has no effect on MCP-served skills; only works for local `.claude/skills/` installs |
| `context: fork` / sub-agent | **No** | MCP-only feature; parent context needed for pattern detection |
| Upsert on POST vs GET-then-POST/PATCH | **GET-then-POST/PATCH** | No API changes needed; existing PATCH creates content versions |
| Description length | **Under 250 chars** | Claude truncates in skill listings; triggers must be in first 130 chars |
| Seed description format | **Single line** | Seed parser is naive `split(":", 1)` — can't handle multiline YAML |
| Default enabled state | **On** (`"true"`) | Opt-out, not opt-in; the skill is harmless until the user approves a push |
| `disable-model-invocation` | **No** | We WANT auto-invocation for pattern detection |

---

## Known Limitations

1. **`notifications/tools/list_changed` is broken in Claude Code** (Issue #13646) — after pushing a skill, the current session won't see it as a new tool. It appears in the next session. The skill body acknowledges this.

2. **No cross-session pattern detection** — the agent can only detect patterns within a single conversation. Server-side pattern mining (analyzing `skill_call_events` across sessions) is a Phase 2 enhancement.

3. **No auth on the API** — anyone who can reach the API can push skills. This is by design (auth was dropped in migration 0004). When ACL returns, `push_skill` will need auth headers.

4. **Bash permission prompt** — since `allowed-tools` doesn't work via MCP, the user may see a Bash permission prompt when the Python script runs. This is acceptable as a secondary confirmation.

5. **Collection-filtered MCP sessions** — skills pushed with no collection (global) are invisible to agents connected with `?collections=` filter. The skill body warns about this.

---

## Research Sources

- [GitHub Copilot: Smarter with fewer tools](https://github.blog/ai-and-ml/github-copilot/how-were-making-github-copilot-smarter-with-fewer-tools/) ��� removed 27 tools, accuracy improved
- [MCP Tool Overload benchmark](https://dev.to/nebulagg/mcp-tool-overload-why-more-tools-make-your-agent-worse-5a49) — 95% -> 71% accuracy at 46 tools
- [Anthropic: Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) — Tool Search shipped to address tool bloat
- [Claude Code Issue #13646](https://github.com/anthropics/claude-code/issues/13646) — `tools/list_changed` notification handler missing
- [Claude Code Issue #25441](https://github.com/anthropics/claude-code/issues/25441) — heredoc permission matching bug
- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — description optimization, third-person voice
- [Claude Agent Skills Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/) — 15K char budget, 250-char truncation
- [Skill description budget research](https://gist.github.com/alexey-pelykh/faa3c304f731d6a962efc5fa2a43abe1) — `description_length + 109` chars per tool
- [CVE-2025-59536](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/) — curl/Bash security in skills
- [MCP vs CLI token usage](https://docs.bswen.com/blog/2026-04-03-mcp-vs-cli-claude-code/) — CLI uses 68% fewer tokens
- [Claude Code Skills are awesome (HN)](https://news.ycombinator.com/item?id=45619537) — activation problem, skills vs MCP community debate
- [Anatomy of .claude folder (HN)](https://news.ycombinator.com/item?id=47543139) — skills "probably the most important" feature
- [Anthropic Skill Creator update](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills) — eval-driven skill development
- [ClawHub publish CLI](https://docs.openclaw.ai/tools/clawhub) — closest existing push pattern
- [Undocumented use-when field (Issue #27569)](https://github.com/anthropics/claude-code/issues/27569) — only `description` matters for triggering
