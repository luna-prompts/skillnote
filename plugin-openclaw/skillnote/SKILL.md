---
name: skillnote
description: "Self-hosted skill registry for OpenClaw. Stores procedures your team writes (name, description, body), syncs them to disk before each task, and collects which-helped/which-failed signals from the agent so the registry improves over time."
version: "0.4.0"
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

Setup is **silent on every load after the first**. If `~/.openclaw/skills/skillnote/config.json` already has a working `host` and the AGENTS.md graft is in place, skip Steps 1-5 and stay quiet.

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

If you find critical files missing from `~/.openclaw/skills/skillnote/` (e.g., `sync.sh`, `log-watcher.py`, `install-backend.sh`), use method 2 to reinstall — don't try to reconstruct missing files.

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

> **SkillNote backend isn't running.** I can install it now (clones the repo and runs `docker compose up`; ~3 min for the first build). Proceed? [Y/n]

**On `n`** — output the manual instructions and STOP setup:

> No problem. When you're ready, run one of:
> ```bash
> bash ~/.openclaw/skills/skillnote/install-backend.sh
> # or
> git clone https://github.com/luna-prompts/skillnote.git && cd skillnote && ./install.sh
> ```
> Then restart this session.

**On `Y`** — run this single command and **stream stdout/stderr back to the user** so they see Docker build progress (don't background it; don't silence it; let them see what's happening for the ~3 min build):

```bash
bash ~/.openclaw/skills/skillnote/install-backend.sh
```

The script handles: prereq check (`git`, `curl`, `docker`-or-`podman`), clone to `$HOME/skillnote`, `./install.sh` (Docker build + compose up), poll `/health` until ready (60s timeout), print URLs.

### If install-backend.sh is missing
Curl the canonical version from GitHub raw:
```bash
curl -sfL https://raw.githubusercontent.com/luna-prompts/skillnote/master/plugin-openclaw/skillnote/install-backend.sh | bash
```
If even that fails (no network), instruct the user to clone the repo manually:
```bash
git clone https://github.com/luna-prompts/skillnote.git && cd skillnote && ./install.sh
```

### Customizing
Set env vars BEFORE invoking install-backend.sh:

| Need | Command |
| ---- | ------- |
| Different install dir | `SKILLNOTE_INSTALL_DIR=$HOME/work/skillnote bash ~/.openclaw/skills/skillnote/install-backend.sh` |
| Port `8082` busy | `SKILLNOTE_API_PORT=8182 bash ~/.openclaw/skills/skillnote/install-backend.sh` |
| Port `3000` busy | `SKILLNOTE_WEB_PORT=3001 bash ~/.openclaw/skills/skillnote/install-backend.sh` |

### If install-backend.sh exits non-zero
Capture the last 20 lines of output and show them verbatim. Common patterns:

| Error pattern | What to suggest |
|---|---|
| `address already in use` / `port is already allocated` | Set a different port via env var (see customization) |
| `Cannot connect to the Docker daemon` | Ask the user to start Docker Desktop / Podman machine |
| `MISSING: <tool>` | The script names the missing tool + install link; relay it to the user |
| anything else | Show the captured output verbatim; don't try to recover blindly |

After success, the URLs appear (`http://localhost:3000`, `http://localhost:8082`). Continue to Step 3.

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
- Spawns the `log-watcher.py` daemon (PID-guarded; won't double-launch)
- Appends the `<skillnote v1>` block to `~/.openclaw/workspace/AGENTS.md` (idempotent; honors `{"grafted": false}` in config)

If sync.sh exits non-zero: capture the output, surface to the user, stop. Don't retry blindly.

## Step 5 — Verify the AGENTS.md graft (sync.sh did it; you just check)

```bash
grep -c '<skillnote v1>' ~/.openclaw/workspace/AGENTS.md
```

| Result | Action |
|---|---|
| `1` | ✅ done; continue to Step 6 |
| `0` | Re-run sync.sh once. If still `0`, surface to user (likely a permissions issue on `~/.openclaw/workspace/`). **Do NOT graft manually with your file-edit tool — that's sync.sh's job.** |
| `≥2` | Duplicate marker — tell the user; do not auto-fix |

### Honoring an opt-out
If the user told you in this session *"don't touch AGENTS.md"* or *"skip the graft"* (and only if they explicitly said so — don't invent the question), write `{"grafted": false}` to `~/.openclaw/skills/skillnote/config.json` BEFORE running sync.sh in Step 4. sync.sh checks that flag and skips the graft.

The block sync.sh appends is the source of truth — don't paraphrase or modify it. If you need to inspect it, read `~/.openclaw/skills/skillnote/sync.sh`.

## Step 6 — Done

Say once on first setup; never again unless re-installing:

> SkillNote connected ✓ Registry at `<host>`.
> N skills synced to `~/.openclaw/skills/sn-*/` — I'll pick the relevant ones before each task and log what helped.
>
> Ask me **"what skills have you been using?"** anytime, or visit `<host>` to see analytics in the web UI.

(Replace N with `ls ~/.openclaw/skills/ | grep -c "^sn-"`.)

On every subsequent session: **complete silence**. Just check the marker is in AGENTS.md; if not, sync.sh re-grafts on next run.

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
   PID=$(cat ~/.openclaw/skills/skillnote/.log-watcher.pid 2>/dev/null) && kill "$PID" 2>/dev/null
   ```
2. **Remove the AGENTS.md graft** (the `<skillnote v1>...</skillnote v1>` block) from `~/.openclaw/workspace/AGENTS.md`.
3. **Remove the skill files:**
   - If `clawhub` is on PATH: `clawhub uninstall skillnote`
   - Otherwise: `rm -rf ~/.openclaw/skills/skillnote`
4. **Optional** (frees disk; loses synced skills): `rm -rf ~/.openclaw/skills/sn-*`
5. **Confirm to the user:**
   > SkillNote removed. AGENTS.md restored, daemon stopped, skill files deleted.

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
- **Don't graft AGENTS.md yourself.** sync.sh handles it. If you find the marker missing, re-run sync.sh — don't use your file-edit tool.
