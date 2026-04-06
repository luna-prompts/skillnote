# PRD: Skill Sync Hook — Full Claude Code Feature Parity via Auto-Install

> Status: IMPLEMENTED (PR3, 2026-04-06) — delivered as a Claude Code Plugin
> Date: 2026-04-05 (brainstorm) / 2026-04-06 (implemented)
> Author: Rudra Naik + Claude Code
> Companion to: [skill-push-prd.md](./skill-push-prd.md)
>
> Implementation notes:
> - Delivered as a Claude Code plugin at `plugin/` (not standalone hooks)
> - Plugin includes: .mcp.json, hooks.json, sync.sh, track-usage.sh, skill-push SKILL.md, skill-creator agent, bin/skillnote-sync
> - SessionStart hook syncs all skills with full frontmatter (extra_frontmatter)
> - PostToolUse[Skill] hook tracks usage automatically (async)
> - Per-project scoping via .skillnote.json (collections filter)
> - Manifest-based create/update/delete tracking
> - Offline-first: 5s connect timeout, graceful fallback
> - 73 plugin tests passing

---

## Problem

Skills served via MCP are "dumb text" — they lose all Claude Code frontmatter features (`allowed-tools`, `context: fork`, `model`, `effort`, `paths`, etc.). These features only work for locally-installed skills in `.claude/skills/`. This limits SkillNote to basic instruction delivery, not intelligent skill execution.

| Feature | Local Skill | MCP Skill |
|---------|------------|-----------|
| `allowed-tools` | Restricts tools during execution | No effect |
| `context: fork` | Runs in isolated sub-agent | No effect |
| `agent: Explore` | Picks sub-agent type | No effect |
| `model: claude-sonnet-4-6` | Override model | No effect |
| `effort: high` | Set reasoning effort | No effect |
| `paths: "src/**/*.ts"` | Auto-activate by file path | No effect |
| `disable-model-invocation` | Prevent auto-triggering | No effect |

The root cause: MCP is a generic tool protocol. It defines name, description, parameters, and response text. It has no concept of skill metadata. Claude Code's rich features are application-level, parsed from local SKILL.md frontmatter only.

## Solution

A **SessionStart hook** that automatically syncs skills from the SkillNote registry to `.claude/skills/` on every session start. Skills execute locally with full Claude Code features. MCP stays connected for management (ratings, push, discovery).

```
Discovery & Management  →  MCP (tool list, ratings, skill-push)
Execution               →  Local skills (full Claude Code features)
Sync                    →  Automated via SessionStart hook (transparent)
```

---

## Architecture

```
Session starts
  → SessionStart hook fires automatically
  → Hook curls GET /v1/skills from SkillNote API
  → Compares with local manifest (.skillnote-manifest.json)
  → New skills     → writes .claude/skills/{slug}/SKILL.md
  → Updated skills → overwrites SKILL.md (content changed)
  → Deleted skills → removes .claude/skills/{slug}/ directory
  → User's own skills → never touched (not in manifest)
  → Claude Code hot-reloads, sees all skills locally
  → Full feature parity. Agent never knows about the sync.
```

### Why Not Have the Agent Write Files?

The agent won't reliably write SKILL.md files from MCP response instructions. It reads the content and follows the instructions — it doesn't bother installing files. That's hoping, not engineering. A system-level hook runs automatically, before any conversation, with zero agent cooperation needed.

### The Two Layers

```
┌──────────────────────────────────────────────────┐
│  LOCAL (.claude/skills/)                          │
│  - Full features: allowed-tools, fork, effort     │
│  - In available_skills context                    │
│  - Auto-synced at session start via hook          │
│  - Agent uses these for execution                 │
└──────────────────────────────────────────────────┘
                    ▲ syncs from
┌──────────────────────────────────────────────────┐
│  MCP (SkillNote server)                           │
│  - complete_skill (ratings)                       │
│  - skill-push (create new skills)                 │
│  - Fallback for mid-session new skills            │
│  - Discovery for unsynced skills                  │
└──────────────────────────────────────────────────┘
```

---

## Sync Lifecycle

### Session Start — Full Sync

```
Hook fires → curls /v1/skills → compares with manifest

  New in API?       → write .claude/skills/{slug}/SKILL.md
  Changed in API?   → overwrite SKILL.md
  Deleted from API? → rm -rf .claude/skills/{slug}/
  User's own skill? → don't touch (not in manifest)

  Update manifest → done
```

### During Session — Stale but Functional

```
Agent uses LOCAL skills (full features)
MCP stays for: complete_skill, skill-push

If skill updated mid-session in SkillNote:
  → current session: uses last-synced version
  → next session: hook syncs latest

If skill pushed mid-session via skill-push:
  → MCP tool appears (basic features, fallback)
  → next session: hook syncs to local (full features)
```

### Session End — Nothing

Local files persist on disk. Next session start triggers sync again.

---

## Manifest File

The hook tracks which skills it manages to avoid touching user-created local skills.

**Path:** `.claude/skills/.skillnote-manifest.json`

```json
{
  "api_url": "http://localhost:8082",
  "last_sync": "2026-04-05T12:00:00Z",
  "skills": ["use-zod-validation", "deploy-checklist", "use-custom-logger"]
}
```

**Sync logic:**

| Skill State | Action |
|-------------|--------|
| In API + not locally | Create (new skill from registry) |
| In API + locally but changed | Overwrite (skill was updated) |
| In API + locally and unchanged | Skip (no-op) |
| In manifest + NOT in API | Delete (skill removed from registry) |
| NOT in manifest + locally | Ignore (user's own skill) |

---

## Collection Filtering

Not all skills need to sync. The hook respects a collection filter (mirrors MCP's `?collections=` param):

```bash
# Sync only specific collections
SKILLNOTE_COLLECTIONS=frontend,conventions

# Or sync everything (default)
SKILLNOTE_COLLECTIONS=  (empty/unset)
```

This matters at scale:

| Registry Size | Recommendation |
|--------------|----------------|
| 5-10 skills | Sync all |
| 30+ skills | Filter by collections (skill descriptions share a ~15K char budget — too many = truncation) |
| 100+ skills | Must filter (Claude can't see most descriptions otherwise) |

---

## The Hook Script

SkillNote provides a sync script that users configure once. The script handles create, update, delete, and manifest management.

```bash
#!/bin/bash
# .claude/hooks/skillnote-sync.sh
API_URL="${SKILLNOTE_API_URL:-http://localhost:8082}"
SKILLS_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude/skills"
MANIFEST="$SKILLS_DIR/.skillnote-manifest.json"
COLLECTIONS="${SKILLNOTE_COLLECTIONS:-}"

# Build API URL with optional collection filter
if [ -n "$COLLECTIONS" ]; then
  FETCH_URL="$API_URL/v1/skills?collections=$COLLECTIONS"
else
  FETCH_URL="$API_URL/v1/skills"
fi

# Fetch skills (silent fail if offline — offline-first)
SKILLS=$(curl -sf "$FETCH_URL" 2>/dev/null) || exit 0

mkdir -p "$SKILLS_DIR"

python3 -c "
import json, sys, os, shutil

skills_dir = '$SKILLS_DIR'
manifest_path = '$MANIFEST'

# Load current skills from API
skills = json.load(sys.stdin)
api_slugs = set()

# Load existing manifest
old_managed = set()
if os.path.exists(manifest_path):
    with open(manifest_path) as f:
        old_manifest = json.load(f)
        old_managed = set(old_manifest.get('skills', []))

synced, created, deleted = 0, 0, 0

# Sync each skill from API
for skill in skills:
    slug = skill['slug']
    api_slugs.add(slug)
    skill_dir = os.path.join(skills_dir, slug)
    os.makedirs(skill_dir, exist_ok=True)

    # Build SKILL.md with full frontmatter
    fm = [f'name: {slug}', f'description: {skill[\"description\"]}']
    if skill.get('collections'):
        fm.append(f'collections: [{\", \".join(skill[\"collections\"])}]')
    extra = skill.get('extra_frontmatter', '') or ''
    if extra.strip():
        fm.append(extra.strip())

    content = '---\n' + '\n'.join(fm) + '\n---\n\n' + (skill.get('content_md') or '')
    filepath = os.path.join(skill_dir, 'SKILL.md')

    # Skip if unchanged
    if os.path.exists(filepath):
        with open(filepath) as f:
            if f.read() == content:
                continue
        synced += 1
    else:
        created += 1

    with open(filepath, 'w') as f:
        f.write(content)

# Delete skills removed from SkillNote (only managed ones)
for slug in old_managed - api_slugs:
    skill_dir = os.path.join(skills_dir, slug)
    if os.path.isdir(skill_dir):
        shutil.rmtree(skill_dir)
        deleted += 1

# Write updated manifest
manifest = {
    'api_url': '$API_URL',
    'skills': sorted(api_slugs)
}
with open(manifest_path, 'w') as f:
    json.dump(manifest, f, indent=2)

parts = []
if created: parts.append(f'{created} new')
if synced: parts.append(f'{synced} updated')
if deleted: parts.append(f'{deleted} removed')
total = len(skills)
if parts:
    print(f'SkillNote: {total} skills ({\", \".join(parts)})')
else:
    print(f'SkillNote: {total} skills (all current)')
" <<< "\$SKILLS"
```

### Hook Registration

In `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/skillnote-sync.sh",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

`"matcher": "startup"` — runs only on fresh sessions, not on resume/clear/compact.

The stdout from the hook (`"SkillNote: 12 skills (2 updated)"`) is injected into Claude's context, so the agent knows the sync happened.

---

## Optional Enhancement: PreToolUse On-Demand Sync

For mid-session updates (skill pushed or updated while session is active), a PreToolUse hook intercepts MCP skill calls and syncs on-demand.

### Hook Registration

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__skillnote__.*",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/skillnote-on-demand.sh"
          }
        ]
      }
    ]
  }
}
```

### On-Demand Script

```bash
#!/bin/bash
# .claude/hooks/skillnote-on-demand.sh
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name')
SLUG=$(echo "$TOOL" | sed 's/mcp__skillnote__//')
API_URL="${SKILLNOTE_API_URL:-http://localhost:8082}"
SKILLS_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude/skills"

# Fetch this specific skill
SKILL=$(curl -sf "$API_URL/v1/skills/$SLUG" 2>/dev/null) || exit 0

# Write/update locally
echo "$SKILL" | python3 -c "
import json, sys, os

skill = json.load(sys.stdin)
slug = skill['slug']
skill_dir = os.path.join('$SKILLS_DIR', slug)
os.makedirs(skill_dir, exist_ok=True)

fm = [f'name: {slug}', f'description: {skill[\"description\"]}']
if skill.get('collections'):
    fm.append(f'collections: [{\", \".join(skill[\"collections\"])}]')
extra = skill.get('extra_frontmatter', '') or ''
if extra.strip():
    fm.append(extra.strip())

content = '---\n' + '\n'.join(fm) + '\n---\n\n' + (skill.get('content_md') or '')
filepath = os.path.join(skill_dir, 'SKILL.md')

with open(filepath, 'w') as f:
    f.write(content)
" 2>/dev/null

# Deny the MCP call — local skill is now installed with full features
cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Skill synced locally with full features. It will auto-trigger from .claude/skills/ or use /SLUG."
  }
}
EOF
```

This intercepts the MCP call, installs the skill locally, and redirects Claude to use the local version. Completely transparent.

---

## Backend Changes

### New: `extra_frontmatter` Column

Stores advanced Claude Code metadata that the MCP protocol can't deliver.

```sql
-- Alembic migration
ALTER TABLE skills ADD COLUMN extra_frontmatter TEXT DEFAULT '';
```

**Stores raw YAML lines** (not structured JSONB):

```
allowed-tools: Read Write Grep
context: fork
effort: high
```

Why raw text: it's concatenated directly into SKILL.md frontmatter output. No parsing or validation needed — it's opaque metadata passed through to Claude Code.

### Schema Update

```python
# SkillCreate / SkillUpdate
extra_frontmatter: str = ""
```

### API Response Update

`GET /v1/skills` and `GET /v1/skills/{slug}` already return all skill fields. Adding `extra_frontmatter` to the `SkillDetail` and `SkillListItem` schemas makes it available to the hook script.

### New: `GET /v1/hooks/sync-script`

Serves the sync script with the correct API URL baked in:

```python
@app.get("/v1/hooks/sync-script", response_class=PlainTextResponse)
def get_sync_script(request: Request):
    api_url = str(request.base_url).rstrip("/")
    return SYNC_SCRIPT_TEMPLATE.replace("{{API_URL}}", api_url)
```

Users install with one command:

```bash
mkdir -p .claude/hooks
curl -s http://localhost:8082/v1/hooks/sync-script > .claude/hooks/skillnote-sync.sh
chmod +x .claude/hooks/skillnote-sync.sh
```

### Optional: `GET /v1/hooks/settings-snippet`

Returns the `.claude/settings.json` hook configuration as a JSON snippet for easy copy-paste:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/skillnote-sync.sh",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

---

## Frontend Changes

### Skill Editor: Advanced Metadata Section

In the `SkillEditTab`, add an expandable section below collections:

```
[v] Advanced Metadata (Claude Code features)

  Extra Frontmatter (YAML):
  ┌──────────────────────────────────────┐
  │ allowed-tools: Read Write Grep       │
  │ context: fork                        │
  │ effort: high                         │
  │                                      │
  └──────────────────────────────────────┘

  These fields only take effect when skills are installed
  locally via the sync hook. Learn more →
```

Or structured fields with dropdowns:

```
  allowed-tools:  [ Read Write Grep Bash(npm *)    ]
  context:        [ fork          v ]
  effort:         [ high          v ]
  model:          [ (default)     v ]
```

### Integrations Page: Sync Hook Setup

The MCP integrations page currently shows MCP connection instructions. Add a **"Full Features (Recommended)"** section:

```
Setup: Full Feature Sync

Skills synced via MCP lack advanced features (tool restrictions,
isolated context, model overrides). For full Claude Code feature
support, add the sync hook:

1. Download the sync script:
   mkdir -p .claude/hooks
   curl -s http://host:8082/v1/hooks/sync-script > .claude/hooks/skillnote-sync.sh
   chmod +x .claude/hooks/skillnote-sync.sh

2. Add to .claude/settings.json:
   [copy button with the hook config JSON]

3. (Optional) Filter by collections:
   export SKILLNOTE_COLLECTIONS=frontend,conventions

Done! Skills sync automatically on every session start.
```

### Settings Page

One new toggle:

**"Sync hook enabled"** — informational only (the hook runs client-side, SkillNote can't control it). But the setting could control whether `GET /v1/hooks/sync-script` returns an active script or a no-op, giving server-side control over the feature.

---

## Change Summary

| Change | File | Complexity |
|--------|------|-----------|
| Add `extra_frontmatter` column | Alembic migration | ~5 lines |
| Add to Skill model | `models/skill.py` | ~1 line |
| Add to schemas | `schemas/skill.py` | ~2 lines |
| `GET /v1/hooks/sync-script` endpoint | new or in `skills.py` | ~15 lines |
| `GET /v1/hooks/settings-snippet` endpoint | same file | ~10 lines |
| Sync script template | `backend/scripts/` or inline | ~60 lines |
| On-demand script template | same location | ~30 lines |
| Advanced metadata in skill editor | `SkillEditTab.tsx` | ~40 lines |
| Integrations page hook setup | `integrations/page.tsx` | ~30 lines |

---

## How This Relates to skill-push

The `skill-push` feature (see [skill-push-prd.md](./skill-push-prd.md)) creates skills via the REST API. When a skill is pushed:

1. Agent collaborates with user → pushes via `POST /v1/skills` (Python urllib)
2. Skill is live in the registry immediately
3. MCP server broadcasts `tools/list_changed` (other MCP clients see it)
4. **Next session start** → sync hook installs it locally with full features
5. From then on, the skill runs locally with `allowed-tools`, `context: fork`, etc.

The `extra_frontmatter` field is shared between both features:
- **skill-push** can set it when creating a skill (the skill body guides the agent to ask about advanced metadata)
- **sync hook** reads it when writing the local SKILL.md

---

## Edge Cases

### Offline / API Unreachable

The hook script uses `curl -sf ... || exit 0`. If the API is down, the hook exits silently. Local skills from the last successful sync remain on disk. Offline-first, consistent with SkillNote's design philosophy.

### First Session (No Local Skills Yet)

First run: hook syncs everything from scratch. All skills created locally. Manifest written. Subsequent sessions only update changes.

### User Edits a Synced Skill Locally

If the user manually edits `.claude/skills/use-zod-validation/SKILL.md`, the next sync will overwrite their changes (the API version takes precedence). The manifest doesn't track local edits.

To handle this gracefully: the hook could compare timestamps or add a `.skillnote-lock` marker to indicate "don't overwrite." But for v1, API-wins is the simplest model. Users who want custom tweaks should edit in the SkillNote web UI (which propagates via sync).

### Multiple Projects, Same Machine

Each project has its own `.claude/skills/` directory. The hook runs per-project. Different projects can sync different collections:

```bash
# Project A: frontend skills only
SKILLNOTE_COLLECTIONS=frontend

# Project B: all skills
SKILLNOTE_COLLECTIONS=
```

### Hook Script Versioning

If SkillNote updates the sync script format, users need to re-download it. The `GET /v1/hooks/sync-script` endpoint should include a version comment at the top:

```bash
#!/bin/bash
# SkillNote sync hook v1.0 — re-download from http://host:8082/v1/hooks/sync-script
```

---

## Research Sources

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — full hook event list and configuration
- [Claude Code 2.1.0 — hot reload for skills](https://help.apiyi.com/en/claude-code-2-1-release-features-en.html) — confirmed live detection of new .claude/skills/ files
- [Mandatory Skill Activation Hook (GitHub Gist)](https://gist.github.com/umputun/570c77f8d5f3ab621498e1449d2b98b6) — SessionStart + UserPromptSubmit patterns
- [Claude Code Skill Activation via Hooks](https://claudefa.st/blog/tools/hooks/skill-activation-hook) — keyword-triggered skill activation
- [PreToolUse hook can modify tool input (Issue #4368)](https://github.com/anthropics/claude-code/issues/4368) — `updatedInput` for transparent redirection
- [Claude Code Hook Examples](https://stevekinney.com/courses/ai-development/claude-code-hook-examples) — real-world hook scripts
- [MCP tools use mcp__server__name namespace](https://code.claude.com/docs/en/hooks) — no collision with local skill names
- [Skill takes precedence over slash command (Issue #15065)](https://github.com/anthropics/claude-code/issues/15065) — local skills have priority
