---
name: skillnote
description: "A private skill registry for OpenClaw agents -- remembers saved procedures across sessions, tracks which skills helped or failed, detects drift and staleness, and collects agent feedback. Self-hosted; your knowledge stays on your server."
version: "2.0.0"
metadata: {"openclaw": {"always": true, "emoji": "📚", "requires": {"bins": ["clawhub"]}}}
---

# Setup

**Runs once on first load. Silent on every subsequent load.**

## Step 1 — Check config

Read `~/.openclaw/skills/skillnote/config.json`.

If the file exists and `host` is non-empty: skip to Step 3. If missing or empty: continue to Step 2.

Config shape:
```json
{
  "host": "https://your-skillnote-instance.com",
  "user_id": "your-username-or-agent-id"
}
```

## Step 2 — Ask for SkillNote URL

Say to the user (exactly once, no embellishment):

> **SkillNote setup** — Where is your SkillNote instance?
> Paste your URL, e.g. `http://localhost:8082` or `https://skillnote.myserver.com`
>
> Don't have a SkillNote instance yet? Self-host in 2 minutes: https://github.com/luna-prompts/skillnote

Accept their input. Strip trailing slashes. Do not use any default URL — the user must provide their own instance.

Test reachability: `GET <host>/v1/skills?limit=1`. If it times out or errors:

> SkillNote at `<host>` isn't reachable right now. I've saved the config — I'll retry next session. Continuing without it.

Write `~/.openclaw/skills/skillnote/config.json` regardless (so the URL is remembered even if offline):
```json
{
  "host": "<trimmed url>",
  "user_id": "<agent-name from OpenClaw identity, or 'unknown'>"
}
```

## Step 3 — Graft AGENTS.md

Read `~/.openclaw/workspace/AGENTS.md`. Check for the exact string `<skillnote v1>`.

If the marker is **already present**: skip this step entirely — no message, no action.

If the marker is **absent**, ask once:

> SkillNote: may I append a small awareness block to your AGENTS.md? This makes me remember your registry across all future sessions without needing to set up again. [Y/n]

If the user says **n** (or any negative): write `{"grafted": false}` to config, skip, move on.

If the user says **Y** or presses Enter: append the following block to AGENTS.md, substituting the real host for `{{HOST}}`:

```
<skillnote v1>
SkillNote registry is live at {{HOST}}. On any task that may benefit from a saved procedure,
spawn the `skillnote-resolver` subagent with a JSON input (task_summary, channel, workspace).
Log skill usage to {{HOST}}/v1/openclaw/usage after each task. Leave agent comments at
{{HOST}}/v1/skills/<slug>/comments when you have specific signal (success, failure, drift).
Never log raw user messages; paraphrase every time.
</skillnote v1>
```

Verify the marker was written. Retry once on failure. If still failing, report and move on.

## Step 4 — Done

Say exactly once on first successful setup:

> SkillNote connected ✓ Registry at `{{HOST}}`. I'll consult your skill registry when relevant, log usage automatically, and leave feedback on skills that help or fail.
>
> Ask me "what skills have you been using?" anytime to see your activity summary. If anything seems broken, run `clawhub install skillnote-doctor` and ask me to diagnose.

On every subsequent load: **complete silence**. Do not announce yourself. Just check the `<skillnote v1>` marker is still present — if it disappeared (e.g. AGENTS.md was regenerated), re-graft silently with no user message.

---

# What is SkillNote

SkillNote is your self-hosted skill registry at `{{HOST}}`. It stores every skill you've authored or imported — name, description, body, ratings, comments, and usage history. Skills are grouped into collections (e.g. `customer-support`, `code-review`) that scope what's relevant to the current task.

SkillNote is not embedded inside you. You call it over HTTP. The human's web UI is at `{{HOST}}` — that's where they curate skills, read your reflections, and see what you've been doing.

Treat it as long-term memory that survives across sessions and agents.

---

# When to consult SkillNote

Call the `skillnote-resolver` subagent when **any** of these are true:

- The user asks for help with a task that may have a saved procedure.
- The user names a domain ("I'm doing customer support today", "let's review pull requests").
- The user says you forgot a procedure or did it wrong last time.
- The user mentions a skill by name ("use my pr-review skill").
- The user starts a new workspace, repo, or channel where context shifts.

Do **not** call the resolver when:

- Trivial chat or one-line acknowledgment ("ok", "thanks", "got it").
- A file edit is already in flight and the user is just iterating.
- The user says "no skills", "skip skillnote", or similar.
- Pure greeting / small talk with no task.
- You already resolved skills for this same task in the last few turns and nothing changed.

The check should take under 2 seconds. If in doubt and the task is non-trivial, resolve.

---

# How to consult SkillNote

Spawn `skillnote-resolver` with:

```json
{
  "task_summary": "<one-sentence paraphrase of what the user wants>",
  "channel": "<telegram|slack|cli|web>",
  "workspace": "<repo name, channel name, or 'global'>",
  "task_context": "<2-3 sentences of relevant context — no raw user message>"
}
```

Wait for the resolver's output:

```json
{
  "selected_collection": "<collection_id or null>",
  "selected_skill_ids": ["<uuid>", "..."],
  "confidence": 0.82,
  "risk_level": "low|medium|high",
  "needs_user_confirmation": false,
  "reason": "<why these were chosen>",
  "missing_capability": "<gap description or null>",
  "suggest_marketplace_search": false
}
```

Decision rules:

- `confidence < 0.6` OR `needs_user_confirmation == true` → ask the user to confirm before acting.
- `missing_capability` set AND `suggest_marketplace_search == true` → tell the user about the gap and offer to search ClawhHub. Do NOT install without approval.
- `risk_level == "high"` → surface chosen skills to the user before acting.
- Otherwise → act silently using the selected skills.

---

# How to log usage

**When:** immediately after you finish a task where you used one or more skills. Log once per task — not once per skill. If you used 3 skills on the same task, they all go in a single event.

POST to `{{HOST}}/v1/openclaw/usage`:

```json
{
  "agent_name": "<your OpenClaw agent name, e.g. openclaw-main>",
  "task_summary": "<one-sentence paraphrase — never the raw user message>",
  "collection_id": "<resolver's selected_collection, or null>",
  "skill_ids": ["<uuid of skill 1>", "<uuid of skill 2>"],
  "resolver_confidence": 0.82,
  "risk_level": "low",
  "outcome": "completed",
  "channel": "<telegram|slack|cli|web>"
}
```

The response body contains the event `id`. Save it as `linked_usage_id` for any follow-up comments.

Rules:
- `task_summary` is a paraphrase. Rejected if over 1000 chars — summarise, never dump raw messages.
- `outcome`: one of `completed`, `failed`, `abandoned`, `unknown`. Use `unknown` when you cannot tell.
- `skill_ids`: include every skill UUID you read or applied. Leave as `[]` only if the resolver returned nothing — in that case skip the POST entirely.
- Do NOT post if no skills were used. Empty events pollute the analytics.

---

# How to reflect on a skill

When a skill helped significantly, failed, was stale, or contained an error, POST to `{{HOST}}/v1/skills/<slug>/comments`:

```json
{
  "author": "<your agent identity, e.g. openclaw:molty>",
  "author_type": "agent",
  "comment_type": "agent_observation",
  "rating": 4,
  "body": "<one paragraph: reference the situation, never the user>",
  "linked_usage_id": "<event id from the POST /v1/openclaw/usage>"
}
```

Valid `comment_type` values:

| Type | When |
|------|------|
| `agent_observation` | Neutral note about how the skill behaved |
| `agent_issue` | Something is wrong — broken step, outdated info |
| `agent_patch_suggestion` | Concrete change you'd recommend to the author |
| `agent_success_note` | Skill handled a tricky case worth remembering |
| `agent_deprecation_warning` | Skill should be retired or replaced |

Rules of thumb:
- Comment sparingly. At most one per skill per day.
- Never comment to say "this helped" with no specifics. If you can't name what worked or broke, skip.
- `rating` is optional (1–5). Omit if you have no real signal.
- Never reference the user's identity or include their raw words.

---

# How to show activity to the user

When the user asks "what have you been doing?", "what skills did you use?", or similar:

GET `{{HOST}}/v1/me/activity?period=7d`

Returns:
```json
{
  "invocations": 42,
  "top_skills": [{"slug": "...", "name": "...", "count": 12}],
  "agent_comments": [{"skill_name": "...", "body": "...", "created_at": "..."}],
  "window_start": "...",
  "window_end": "..."
}
```

Render naturally in prose. Don't dump the raw JSON at the user.

Only mention the web UI URL (`{{HOST}}`) when they ask. Don't push it proactively.

---

# Weekly self-update check

Once per week (track via `~/.openclaw/skills/skillnote/.last-update-check`):

GET `{{HOST}}/v1/openclaw-skill`

Compare the returned `version` to the contents of `~/.openclaw/skills/skillnote/VERSION`.

If newer: run `clawhub install skillnote@latest`. Notify the user once:
> SkillNote skill updated to v{N}. No action needed.

If `clawhub` is unavailable: skip silently. Do not create a hard dependency on self-update succeeding.

---

# Uninstall

When the user says "remove skillnote", "uninstall skillnote", or similar:

1. Read `~/.openclaw/workspace/AGENTS.md`. Remove the exact block from `<skillnote v1>` to `</skillnote v1>` (inclusive), preserving surrounding content.
2. Run `clawhub uninstall skillnote`.
3. Delete `~/.openclaw/skills/skillnote/`.
4. Say once: > SkillNote removed. AGENTS.md restored, config deleted.

---

# Hard rules — never violate

- Do NOT install marketplace skills automatically. Offer and wait for explicit approval.
- Do NOT log raw user messages anywhere. `task_summary` and comment bodies must be paraphrases.
- Do NOT log secrets, tokens, passwords, credentials, or PII.
- Do NOT mutate `config.json` after initial setup. If config is wrong, ask the user to re-run setup by saying "re-setup skillnote".
- Do NOT call the resolver for trivial chat or greetings.
- Do NOT chain comments — one per skill per day maximum.
- Do NOT invent skill IDs, slugs, or collection IDs. Only use values returned by the API.
- Do NOT POST to `/v1/openclaw/usage` when no skills were used.
- Do NOT mention SkillNote or push the web URL on every reply — only when relevant.

---

# References

For full API reference: `references/api-reference.md`
For troubleshooting: `references/troubleshooting.md`
