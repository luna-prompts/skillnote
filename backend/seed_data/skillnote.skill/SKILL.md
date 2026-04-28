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

```json
{
  "host": "https://your-skillnote-instance.com",
  "user_id": "your-username-or-agent-id"
}
```

## Step 2 — Ask for SkillNote URL

Say to the user (exactly once):

> **SkillNote setup** — Where is your SkillNote instance?
> Paste your URL, e.g. `http://localhost:8082` or `https://skillnote.myserver.com`
>
> Don't have one yet? Self-host in 2 minutes: https://github.com/luna-prompts/skillnote

Accept their input. Strip trailing slashes. Do not use any default URL.

Test reachability: `GET <host>/v1/skills?limit=1`. If it fails:

> SkillNote at `<host>` isn't reachable right now. I've saved the config — I'll retry next session.

Write `~/.openclaw/skills/skillnote/config.json` regardless:
```json
{
  "host": "<trimmed url>",
  "user_id": "<agent name or 'unknown'>"
}
```

## Step 3 — Graft AGENTS.md

Read `~/.openclaw/workspace/AGENTS.md`. Check for the exact string `<skillnote v1>`.

If **already present**: skip entirely.

If **absent**, ask once:

> SkillNote: may I add a small block to your AGENTS.md so I remember your registry across sessions? [Y/n]

If **n**: write `{"grafted": false}` to config and move on.

If **Y**: append the following block, substituting the real host for `{{HOST}}`:

```
<skillnote v1>
SkillNote registry: {{HOST}}

You MUST check SkillNote for any task involving code, writing, debugging, reviewing, deploying, or creating.

Step 1 — BEFORE responding, call exec:
  curl -s -X POST {{HOST}}/v1/openclaw/context-bundle -H 'Content-Type: application/json' -d '{"task_summary":"<one sentence paraphrase>","channel":"<channel>","workspace":"<workspace>"}'
  The response contains skills with their full content_md bodies. Read and apply any that are relevant.

Step 2 — AFTER finishing, log usage with exec:
  curl -s -X POST {{HOST}}/v1/openclaw/usage -H 'Content-Type: application/json' -d '{"agent_name":"<your-agent-id>","task_summary":"<paraphrase>","skill_ids":["<id>"],"outcome":"completed","channel":"<channel>"}'
  Use id fields from step 1. Skip if no skills were relevant.

Only skip steps 1-2 for pure small talk ("hi", "thanks"). Never log raw user messages.
</skillnote v1>
```

Verify the marker was written. Retry once on failure.

## Step 4 — Done

Say exactly once on first setup:

> SkillNote connected ✓ Registry at `{{HOST}}`. I'll fetch your saved procedures before each task and log what helped.
>
> Ask me "what skills have you been using?" to see your activity. If something's broken, run `clawhub install skillnote-doctor`.

On every subsequent load: **complete silence**. Just verify the `<skillnote v1>` marker is still in AGENTS.md — if it disappeared, re-graft silently.

---

# What is SkillNote

SkillNote is your self-hosted skill registry at `{{HOST}}`. It stores procedures your team has written — name, description, body, ratings, comments, and usage history. Skills are grouped into collections (e.g. `code-review`, `devops`) that scope what's relevant.

The web UI at `{{HOST}}` is where humans curate skills and read your feedback. Treat it as persistent memory that survives across sessions and agents.

---

# How to fetch skills for a task

Call `POST {{HOST}}/v1/openclaw/context-bundle` with:

```json
{
  "task_summary": "<one-sentence paraphrase>",
  "channel": "<telegram|slack|cli|web>",
  "workspace": "<repo, channel, or 'global'>"
}
```

The response gives you up to 20 skills ordered by usage and rating. Each skill includes:
- `id` (UUID — use this for logging)
- `slug`, `name`, `description`
- `content_md` — the full skill body, apply it
- `usage_count_30d`, `rating_avg`, `staleness_status`

Pick the 1-3 most relevant skills. If `staleness_status` is `needs_review`, prefer a healthy alternative. If nothing fits, skip logging entirely.

---

# How to log usage

After completing a task where skills were applied, POST to `{{HOST}}/v1/openclaw/usage`:

```json
{
  "agent_name": "<your agent id>",
  "task_summary": "<paraphrase — never the raw user message>",
  "skill_ids": ["<uuid>", "..."],
  "outcome": "completed",
  "channel": "<channel>"
}
```

`outcome`: `completed` | `failed` | `abandoned` | `unknown`

Do NOT post if no skills were used.

---

# How to reflect on a skill

When a skill clearly helped, failed, or is stale, POST to `{{HOST}}/v1/skills/<slug>/comments`:

```json
{
  "author": "<your agent id>",
  "author_type": "agent",
  "comment_type": "agent_observation",
  "body": "<one paragraph — no user info, no raw messages>"
}
```

Valid `comment_type` values: `agent_observation`, `agent_issue`, `agent_patch_suggestion`, `agent_success_note`, `agent_deprecation_warning`

At most one comment per skill per day. Only comment when you have specific signal.

---

# How to show activity

When the user asks "what skills have you been using?" or similar:

GET `{{HOST}}/v1/me/activity?period=7d`

Render the result in natural prose — top skills used, any recent feedback left. Don't dump raw JSON.

---

# Weekly self-update check

Once per week (track via `~/.openclaw/skills/skillnote/.last-update-check`):

GET `{{HOST}}/v1/openclaw-skill`

Compare the returned `version` to `~/.openclaw/skills/skillnote/VERSION`. If newer, run `clawhub install skillnote@latest` and notify once.

---

# Uninstall

When the user says "remove skillnote" or "uninstall skillnote":

1. Remove the `<skillnote v1>…</skillnote v1>` block from `~/.openclaw/workspace/AGENTS.md`.
2. Run `clawhub uninstall skillnote`.
3. Delete `~/.openclaw/skills/skillnote/`.
4. Say: > SkillNote removed. AGENTS.md restored, config deleted.

---

# Hard rules

- Do NOT log raw user messages. Always paraphrase.
- Do NOT log secrets, tokens, credentials, or PII.
- Do NOT post usage events when no skills were used.
- Do NOT comment more than once per skill per day.
- Do NOT invent skill IDs or slugs — only use values from the API.
- Do NOT mention SkillNote on every reply — only when relevant.
- Do NOT mutate config.json after setup. If wrong, ask user to say "re-setup skillnote".
