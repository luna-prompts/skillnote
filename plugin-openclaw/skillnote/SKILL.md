---
name: skillnote
description: "Self-hosted skill registry for OpenClaw. Stores procedures your team writes (name, description, body), syncs them to disk before each task, and collects which-helped/which-failed signals from the agent so the registry improves over time."
version: "0.5.4"
homepage: "https://github.com/luna-prompts/skillnote"
metadata:
  openclaw:
    always: true
    emoji: "📚"
    os: ["macos", "linux"]
    primaryEnv: SKILLNOTE_BASE_URL
    requires:
      env: [SKILLNOTE_BASE_URL]
      bins: [curl, python3]
    envVars:
      - name: SKILLNOTE_BASE_URL
        required: true
        description: "URL of your self-hosted SkillNote instance, e.g. http://localhost:8082"
---

# Quick orientation

You are running with the SkillNote skill loaded. Your responsibilities, in order:

1. **Setup** (Steps 1-6 below) — one-time per machine; ~30s if backend is already running, ~3 min if you need to install it
2. **Pick + apply** the right skills before responding to user tasks
3. **Log + rate** what worked after the task is done

Setup is **silent on every load after the first**. If `~/.openclaw/skills/skillnote/config.json` already has a working `host` and `~/.openclaw/skillnote-agents.md` exists, skip Steps 1-5 and stay quiet.

---

# How this skill got onto disk (recovery info)

This `SKILL.md` lives at `~/.openclaw/skills/skillnote/` and arrived via one of:

1. **clawhub** (recommended):
   ```bash
   clawhub install skillnote
   ```
2. **curl bundle installer** (works against any reachable SkillNote backend):
   ```bash
   curl -sf $SKILLNOTE_BASE_URL/setup/agent | bash -s -- --agent openclaw
   ```
   If `$SKILLNOTE_BASE_URL` isn't set, default to `http://localhost:8082`.
3. **Manual ZIP** — download `<host>/v1/openclaw-bundle.zip` and unzip into `~/.openclaw/skills/`. Air-gapped only.

If you find critical files missing from `~/.openclaw/skills/skillnote/` (e.g., `sync.sh`, `log-watcher.py`), use method 2 to reinstall — don't try to reconstruct missing files.

---

# Setup

## Step 1 — Resolve the backend URL

Layered lookup; stop at first match:
1. `$SKILLNOTE_BASE_URL` env var
2. `~/.openclaw/skillnote/config.json` → `host`
3. `~/.openclaw/skills/skillnote/config.json` → `host`
4. Default: `http://localhost:8082`

Reachability check: `GET <host>/v1/skills?limit=1`.

- **Reachable** → skip to Step 3 (persist).
- **Unreachable AND host == `http://localhost:8082`** → likely no backend on this machine yet. Continue to Step 2.
- **Unreachable AND host is custom** → user pointed at a specific server; do NOT auto-install. Tell the user it's down and stop:
  > SkillNote at `<host>` isn't reachable. Either the server is down, or the URL is wrong. I'll retry next session.

## Step 2 — Stand up the backend (only if Step 1 routed here)

Tell the user what's about to happen, then ask once:

> **SkillNote backend isn't running.** Run this in another terminal (takes ~3 min for the first Docker image pull):
>
> ```bash
> npx skillnote start
> ```
>
> When the CLI prints `Services healthy` and shows the URL table, come back and tell me "done" and I'll continue setup.

Wait for the user to confirm. Do not run the command yourself — `npx` pulling code from the registry and starting Docker containers from inside an `always: true` skill is the exact pattern static scanners flag as a "dropper." The user runs it themselves so the install action is theirs and auditable.

After the user confirms the backend is up:
- Re-run the reachability check from Step 1 (`GET <host>/v1/skills?limit=1`).
- If reachable → continue to Step 3.
- If still unreachable after 3 retries spaced 5s apart: ask the user to share the last 20 lines of `npx skillnote start` output; surface their error verbatim; stop.

### Customizing the install
If the user needs non-default ports, pass CLI flags to `skillnote start`:

| Need | Command |
| ---- | ------- |
| Port `8082` busy | `npx skillnote start --api-port 8182` |
| Port `3000` busy | `npx skillnote start --web-port 3001` |
| Bind to a LAN IP | `SKILLNOTE_HOST=<your-lan-ip> npx skillnote start` |

## Step 3 — Persist the resolved host (idempotent)

Strip trailing slashes. Write to `~/.openclaw/skills/skillnote/config.json`:

```json
{
  "host": "<resolved url>",
  "user_id": "<see below>"
}
```

For `user_id`: use your **real OpenClaw agent name** when known (e.g., `main`, `support-bot`, `dev-helper`). It's the identity that surfaces in analytics — multiple agents collapsing into one user_id loses signal. If you genuinely don't know your agent name, use `openclaw-main` as a fallback only.

## Step 4 — First sync (populates skills locally)

```bash
chmod +x ~/.openclaw/skills/skillnote/sync.sh && ~/.openclaw/skills/skillnote/sync.sh
```

Tell the user "Syncing skills from the registry…" — sync usually takes a couple seconds. The script:
- Fetches the catalog (`GET <host>/v1/skills`)
- Writes one `~/.openclaw/skills/sn-<slug>/SKILL.md` per skill (with rating-footer pre-baked)
- Spawns the `log-watcher.py` daemon (single-instance, pgrep-guarded)
- Writes `~/.openclaw/skillnote-agents.md` (the sidecar instructions file; idempotent; honors `{"grafted": false}` in config)

If sync.sh exits non-zero: capture the output, surface to the user, stop. Don't retry blindly.

## Step 5 — Wire the sidecar into AGENTS.md (one-time, user-confirmed)

sync.sh writes the `<skillnote v1>` instructions to a sidecar file: `~/.openclaw/skillnote-agents.md`. For OpenClaw to actually pick up those instructions, the user's own `~/.openclaw/workspace/AGENTS.md` needs to `@include` it. This is a **one-line edit, one time, with user confirmation** — not something sync.sh does itself.

First, check if it's already wired:

```bash
grep -c 'skillnote-agents.md' ~/.openclaw/workspace/AGENTS.md 2>/dev/null
```

| Result | Action |
|---|---|
| `1` | ✅ already wired; continue to Step 6 |
| `0` or file missing | Ask the user (once, explicit consent): "I need to add one line to your `~/.openclaw/workspace/AGENTS.md` so OpenClaw picks up the SkillNote instructions: `@include ~/.openclaw/skillnote-agents.md`. OK to add it?" |
| `≥2` | Already wired multiple times — tell the user; don't auto-fix |

**On user `Y`** — append the line:
```bash
mkdir -p ~/.openclaw/workspace
echo '@include ~/.openclaw/skillnote-agents.md' >> ~/.openclaw/workspace/AGENTS.md
```

**On user `n`** — write `{"grafted": false}` to `~/.openclaw/skills/skillnote/config.json` so sync.sh stops regenerating the sidecar, and tell them:
> No problem. SkillNote will sync skills but won't inject instructions into your agent. Re-run `~/.openclaw/skills/skillnote/sync.sh` and add the `@include` line later if you change your mind.

The sidecar content is sync.sh's source of truth — don't paraphrase or copy it inline. If you need to inspect it, read `~/.openclaw/skillnote-agents.md`.

## Step 6 — Done

Say once on first setup; never again unless re-installing:

> SkillNote connected ✓ Registry at `<host>`.
> N skills synced to `~/.openclaw/skills/sn-*/` — I'll pick the relevant ones before each task and log what helped.
>
> Ask me **"what skills have you been using?"** anytime, or visit `<host>` to see analytics in the web UI.

(Replace N with `ls ~/.openclaw/skills/ | grep -c "^sn-"`.)

On every subsequent session: **complete silence**. Just check that `~/.openclaw/skillnote-agents.md` exists and AGENTS.md still has the `@include` line; if not, surface to the user (don't auto-fix the @include — it requires their consent).

---

# How to pick which skills to apply (do this BEFORE responding to a task)

Before responding to any non-trivial task (anything beyond small talk), you have all synced skills available at `~/.openclaw/skills/sn-*/SKILL.md`.

### v1 picking method (works well up to ~15-20 skills)

1. **Read just the frontmatter `description` field** of every `sn-*/SKILL.md` (cheap — ~200 chars each).
2. **Pick at most 3** whose description language overlaps with the task language. Be conservative: 0 is a valid answer.
3. **Read the full `SKILL.md`** of those 1-3 selected skills.
4. **Apply their guidance** to the task.
5. **Hard cap: never load more than 5 sn-* SKILL.md files into context for a single task.** If 5+ seem relevant, you've over-matched — re-read the task and tighten.

### Edge cases

| Situation | What to do |
|---|---|
| 0 relevant skills | Proceed normally; no usage event needed |
| Two skills give conflicting advice | Apply both lenses; surface the conflict to the user; ask which to follow |
| User explicitly invokes a skill ("use sn-error-handling") | Read just that one; no further picking |
| Past 20 skills, picking accuracy degrades | Bias toward skills with high `call_count`/`avg_rating` (visible in `<host>/v1/analytics/top-skills`); a future version offloads picking to a server-side resolver |

---

# How to log usage (after task completion)

POST to `<host>/v1/openclaw/usage`. **Use slugs** (the `sn-*` directory name without the `sn-` prefix), not UUIDs:

```json
{
  "agent_name": "<your real agent name>",
  "task_summary": "<paraphrase — never the raw user message>",
  "skill_slugs": ["error-handling", "git-commit-convention"],
  "outcome": "completed | failed | abandoned | unknown",
  "channel": "<see Channel detection below>"
}
```

**The response includes `id` — capture it.** You'll need it as `linked_usage_id` when you also rate the skill.

### Picking the right `outcome` honestly

This field is the only signal we have for whether skills are actually working. Be honest — defaulting everything to `completed` makes the registry useless.

- **`completed`** — skill applied AND produced the intended result
- **`failed`** — skill applied BUT didn't help (wrong result, error, or trigger criteria didn't match the actual situation). Diagnose in `task_summary`: *"Tried sn-X for Y but its trigger criteria didn't match the actual exception type."*
- **`abandoned`** — considered the skill, started applying, didn't finish (timeout, scope changed mid-task, switched skills partway through)
- **`unknown`** — only when truly uncertain (no clear signal whether the user accepted the answer). Bias toward `completed` or `failed` — `unknown` is uninformative

### Channel detection

Infer `channel` from where the task came in. Use these slug-style values (lowercase, slash-separated):

| Source | `channel` value |
|---|---|
| Slack DM | `slack/dm/<user_handle>` |
| Slack channel | `slack/<channel_name>` |
| Discord | `discord/<channel_name>` |
| iMessage | `imessage` |
| Email reply | `email` |
| Webhook trigger | `webhook` |
| `openclaw agent` CLI | `cli` |
| Cron-triggered task | `cron/<job_name>` |
| Web UI / control panel | `webchat` |
| Unknown / mixed | `unknown` |

Channel matters for analytics breakdown — the team will eventually want to ask *"which skills do I use most in #support vs #eng?"*.

### Don't post if
- No skill was applied (don't post empty events — they pollute analytics)
- Task was pure small talk ("hi", "thanks")

---

# How to reflect on a skill (rate or comment)

POST to `<host>/v1/skills/<slug>/comments`. **Always include `linked_usage_id`** (the `id` from the `/v1/openclaw/usage` POST you just made for this same task) so the comment correlates to specific work:

```json
{
  "author": "<your real agent name>",
  "author_type": "agent",
  "comment_type": "agent_success_note",
  "rating": 5,
  "linked_usage_id": "<id from /v1/openclaw/usage response>",
  "body": "<one paragraph — no user info, no raw messages>"
}
```

If you genuinely don't have a `linked_usage_id`, omit the field — never invent one.

### Picking the right `comment_type`

| Type | When to use | Rating |
|---|---|---|
| `agent_success_note` | Skill clearly helped — produced the right result, saved time | 4-5 |
| `agent_issue` | Skill applied but produced wrong result, error, or hurt | 1-2 |
| `agent_observation` | Neutral note: skill behaves a certain way; worth knowing for future picks | omit `rating` |
| `agent_patch_suggestion` | You have a concrete fix to suggest (include the suggested change in `body`) | 2-3 typically |
| `agent_deprecation_warning` | Skill references things that don't exist anymore, trigger criteria misleading, or hasn't been useful in many tasks | 1-2 |

### Self-restraint
- At most **one comment per skill per day** (the backend doesn't enforce this; you do)
- Only comment when you have **specific signal** — vague "nice skill" or "didn't really use it" comments add noise

---

# How to show activity (when user asks)

When the user asks "what skills have you been using?" or similar, fetch:

```
GET <host>/v1/me/activity?period=7d
```

Render in natural prose: top skills by usage, ratings you left, any patterns you noticed. **Don't dump raw JSON** — summarize.

---

# Daily self-update check

`sync.sh` does this automatically every 24 hours (tracked via `~/.openclaw/skills/skillnote/.last-version-check`):

1. `GET <host>/v1/openclaw-skill` → returns `{version, skill}`
2. Compare to `~/.openclaw/skills/skillnote/VERSION`
3. If newer:
   - If `clawhub` is on PATH: `clawhub install skillnote@<ver>`
   - Otherwise: overwrite `SKILL.md` + `VERSION` inline from the response

You don't need to do anything for self-updates. If a notification appears that the skill was updated, prefer to re-read SKILL.md before continuing — the steps may have changed.

---

# Uninstall

When the user says "remove skillnote" or "uninstall skillnote":

1. **Stop the daemon:**
   ```bash
   pkill -f "python3 .*log-watcher\.py" 2>/dev/null
   ```
2. **Ask the user to remove the `@include` line** from their `~/.openclaw/workspace/AGENTS.md`:
   > Open `~/.openclaw/workspace/AGENTS.md` and delete the line `@include ~/.openclaw/skillnote-agents.md`. (I won't auto-edit your AGENTS.md.)
3. **Remove the sidecar:**
   ```bash
   rm -f ~/.openclaw/skillnote-agents.md
   ```
4. **Remove the skill files:**
   - If `clawhub` is on PATH: `clawhub uninstall skillnote`
   - Otherwise: `rm -rf ~/.openclaw/skills/skillnote`
5. **Optional** (frees disk; loses synced skills): `rm -rf ~/.openclaw/skills/sn-*`
6. **Confirm to the user:**
   > SkillNote removed. Daemon stopped, sidecar deleted, skill files removed. One thing left: delete the `@include` line from your AGENTS.md.

The SkillNote backend itself stays running — it's separate from this skill. To stop it too: `cd <skillnote-repo> && docker compose down`.

---

# Hard rules

- **Use `skill_slugs`, not `skill_ids`.** Synced skills don't have `id:` in their frontmatter; the slug is the `sn-*` directory name without the `sn-` prefix.
- **Never log raw user messages or PII.** Always paraphrase task summaries.
- **Never log secrets, tokens, or credentials** — even if the user pasted them.
- **Don't post usage events when no skill was applied.** Empty events pollute analytics.
- **Don't comment more than once per skill per day** (self-enforced — backend doesn't check).
- **Don't mention SkillNote on every reply.** Only when relevant or when the user asks about activity.
- **Don't mutate `config.json` after setup.** If the host needs to change, ask the user to say "re-setup skillnote" so they consent explicitly.
- **Don't auto-edit AGENTS.md.** sync.sh writes the sidecar `~/.openclaw/skillnote-agents.md`; adding the `@include` line to AGENTS.md is a one-time user-consented edit (Step 5). On every subsequent session: don't re-graft, don't re-ask. If the line was deleted by the user, leave it alone — that's their signal.
- **Don't auto-install the backend.** If `localhost:8082` is unreachable, give the user the single command (`npx skillnote start`) and wait for them to run it. Do not run `npx`/Docker/install scripts on the user's behalf or chain them into other commands.
