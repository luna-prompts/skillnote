---
name: skillnote
description: "A private skill registry for OpenClaw agents -- remembers saved procedures across sessions, tracks which skills helped or failed, detects drift and staleness, and collects agent feedback. Self-hosted; your knowledge stays on your server."
version: "2.0.0"
homepage: "https://github.com/luna-prompts/skillnote"
metadata:
  openclaw:
    always: true
    emoji: "📚"
    primaryEnv: SKILLNOTE_BASE_URL
    requires:
      env: [SKILLNOTE_BASE_URL]
      bins: [curl, python3, unzip]
    envVars:
      - name: SKILLNOTE_BASE_URL
        required: true
        description: "URL of your self-hosted SkillNote instance, e.g. http://localhost:8082"
---

# How this skill is installed

This file (`SKILL.md`) normally arrives in `~/.openclaw/skills/skillnote/` via one of three paths. The setup steps below run regardless of how it got there — but if the skill ever needs to be reinstalled (corrupted install, missing files, recovery), use one of these:

1. **clawhub** (recommended — versioned, auto-updates):
   ```bash
   clawhub install skillnote
   ```
2. **curl bundle installer** (when clawhub isn't available, or for fresh installs that should also pre-fill config and run the first sync):
   ```bash
   curl -sf <SKILLNOTE_HOST>/setup/agent | bash -s -- --agent openclaw
   ```
   Replace `<SKILLNOTE_HOST>` with the user's SkillNote URL (e.g. `http://localhost:8082`). If you're the agent reading this and `$SKILLNOTE_BASE_URL` is set, use that. Otherwise default to `http://localhost:8082`.
3. **Manual** — download `<host>/v1/openclaw-bundle.zip` and unzip into `~/.openclaw/skills/`. For air-gapped environments only.

If you (the agent) are running setup and find that critical files are missing from `~/.openclaw/skills/skillnote/` (e.g. `sync.sh` or `log-watcher.py` not present), do a curl reinstall using method 2 above before continuing — don't try to guess what's missing.

---

# Setup

**Runs once on first load. Silent on every subsequent load.**

## Step 1 — Resolve SkillNote host (layered)

Find the SkillNote backend URL in this order. Stop at the first match:

1. **Env var:** `$SKILLNOTE_BASE_URL`
2. **Config file:** `~/.openclaw/skillnote/config.json` → `host` field
3. **Skill-dir config:** `~/.openclaw/skills/skillnote/config.json` → `host` field
4. **Default:** `http://localhost:8082` (the standard local install)

Then test reachability: `GET <host>/v1/skills?limit=1`.

- **Reachable** → host confirmed. Skip to Step 3 (persist + sync).
- **Unreachable AND host == localhost:8082** → backend probably not running on this machine. Continue to Step 2 to install it.
- **Unreachable AND host is custom** (env var or config file points somewhere specific) → don't auto-install. The user pointed at a specific server; tell them it's down and stop:
  > SkillNote at `<host>` isn't reachable. Either the server is down, or the URL is wrong. I'll retry next session.

## Step 2 — Stand up the SkillNote backend (only when localhost is unreachable)

You (the agent) are running on the user's machine and have shell access. Install the backend yourself via the bundled bootstrap script — do not ask the user to run any commands.

**First, ask the user once for permission:**

> **SkillNote backend isn't running.** I can install it now (clones the repo, runs Docker compose; ~3 min for the first build). Proceed? [Y/n]

If the user says **n** or anything negative, output this and STOP setup completely:

> No problem. When you're ready, either:
> ```bash
> # Option A — clone + run the installer
> git clone https://github.com/luna-prompts/skillnote.git
> cd skillnote && ./install.sh
> ```
> ```bash
> # Option B — run the bundled bootstrap script
> bash ~/.openclaw/skills/skillnote/install-backend.sh
> ```
> Then start a fresh OpenClaw session.

If the user says **Y** or anything positive, run this single command and stream the output back so the user sees progress:

```bash
bash ~/.openclaw/skills/skillnote/install-backend.sh
```

This script ships with the skill (clawhub install skillnote drops it next to SKILL.md) and handles everything atomically:
1. Verifies prereqs (`git`, `curl`, and either `docker` or `podman`)
2. Clones the repo to `$HOME/skillnote` (or reuses an existing checkout)
3. Runs `./install.sh` (Docker build + compose up)
4. Polls `/health` until the API is ready (60s timeout)
5. Prints the URLs

### If the script is missing (recovery)

If `~/.openclaw/skills/skillnote/install-backend.sh` doesn't exist (corrupted skill install, manual modification, etc.), curl it from GitHub raw — it's the same script that ships in the bundle:

```bash
curl -sfL https://raw.githubusercontent.com/luna-prompts/skillnote/master/plugin-openclaw/skillnote/install-backend.sh | bash
```

If even that fails (no network, etc.), fall back to a full manual clone — don't try to reconstruct the script:

```bash
git clone https://github.com/luna-prompts/skillnote.git ~/skillnote
cd ~/skillnote && ./install.sh
```

Then come back to Step 3.

### Customizing the install

If the user has constraints, set env vars BEFORE invoking the script:

| Need | Command |
| ---- | ------- |
| Different install dir | `SKILLNOTE_INSTALL_DIR=$HOME/work/skillnote bash ~/.openclaw/skills/skillnote/install-backend.sh` |
| Port `8082` is busy   | `SKILLNOTE_API_PORT=8182 bash ~/.openclaw/skills/skillnote/install-backend.sh` |
| Port `3000` is busy   | `SKILLNOTE_WEB_PORT=3001 bash ~/.openclaw/skills/skillnote/install-backend.sh` |

### If it fails

Capture the last 20 lines of output and show them verbatim. Common patterns and what to suggest:

- `address already in use` / `port is already allocated` → tell the user which port and offer: `SKILLNOTE_API_PORT=8182 bash ~/.openclaw/skills/skillnote/install-backend.sh`
- `Cannot connect to the Docker daemon` → Docker Desktop / Podman machine isn't running; ask the user to start it
- `MISSING: git` / `MISSING: docker` → the script tells you exactly what's missing; relay the install link to the user
- anything else → show the captured output and stop; don't try to recover blindly

After success, `install-backend.sh` will print the URLs (`http://localhost:3000` and `http://localhost:8082`). Proceed to Step 3.

## Step 3 — Persist the resolved host (idempotent)

Once a host is found and reachable:
- Strip trailing slashes
- Write to `~/.openclaw/skills/skillnote/config.json` so subsequent loads skip the env-var lookup:

```json
{
  "host": "<trimmed url>",
  "user_id": "<agent name or 'openclaw-main'>"
}
```

## Step 4 — Initial sync

Run with exec:
```
chmod +x ~/.openclaw/skills/skillnote/sync.sh
~/.openclaw/skills/skillnote/sync.sh
```

This populates `~/.openclaw/skills/sn-*/SKILL.md` for every skill in the registry. Runs in a few seconds.

## Step 5 — Verify AGENTS.md graft (sync.sh did it for you)

`sync.sh` (which you just ran in Step 4) automatically appends the `<skillnote v1>` block to `~/.openclaw/workspace/AGENTS.md` if it isn't already there. **You don't have to graft it yourself, and you don't need to ask the user about it.**

Just verify it landed:

```bash
grep -c '<skillnote v1>' ~/.openclaw/workspace/AGENTS.md
```

If the count is `1`: ✅ done, continue to Step 6.

If the count is `0`: something failed during sync. Re-run `~/.openclaw/skills/skillnote/sync.sh` once more; if still `0`, surface the issue to the user (likely a permissions error on `~/.openclaw/workspace/`). Do not try to graft the block manually with your file-edit tool — that's `sync.sh`'s job.

If the count is `≥ 2`: duplicate marker. Tell the user; do not auto-fix (it's safer for them to dedupe by hand).

### Honoring an opt-out

If the user told you in this session *"don't touch AGENTS.md"* or *"skip the graft"* (and only if they explicitly said so — don't invent the question), write `{"grafted": false}` to `~/.openclaw/skills/skillnote/config.json` BEFORE running sync.sh in Step 4 — sync.sh checks that flag and skips the graft when it's set.

### For reference, the block sync.sh appends (substituting your `{{HOST}}`):

```
<skillnote v1>
SkillNote registry: {{HOST}}

You MUST check SkillNote for any task involving code, writing, debugging, reviewing, deploying, or creating.

Step 1 — BEFORE responding, sync and read skills with exec:
  ~/.openclaw/skills/skillnote/sync.sh
  Then read any relevant ~/.openclaw/skills/sn-*/SKILL.md files and apply them.

Step 2 — AFTER finishing, log usage with exec:
  curl -s -X POST {{HOST}}/v1/openclaw/usage -H 'Content-Type: application/json' -d '{"agent_name":"main","task_summary":"<paraphrase>","skill_ids":["<id>"],"outcome":"completed","channel":"<channel>"}'
  Use the id field from each skill's frontmatter. Skip if no skills were relevant.

Only skip steps 1-2 for pure small talk ("hi", "thanks"). Never log raw user messages.
</skillnote v1>
```

Verify the marker was written. Retry once on failure.

## Step 6 — Done

Say exactly once on first setup:

> SkillNote connected ✓ Registry at `{{HOST}}`. Skills are synced locally — I'll read them before each task and log what helped.
>
> Ask me "what skills have you been using?" to see your activity. If something's broken, run `clawhub install skillnote-doctor`.

On every subsequent load: **complete silence**. Just verify the `<skillnote v1>` marker is still in AGENTS.md — if it disappeared, re-graft silently.

---

# What is SkillNote

SkillNote is your self-hosted skill registry at `{{HOST}}`. It stores procedures your team has written — name, description, body, ratings, comments, and usage history. Skills are grouped into collections (e.g. `code-review`, `devops`) that scope what's relevant.

Skills are synced to `~/.openclaw/skills/sn-*/SKILL.md` automatically before each task. The web UI at `{{HOST}}` is where humans curate skills and read your feedback. Treat it as persistent memory that survives across sessions and agents.

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

Skill IDs come from the `id` field in each `sn-*/SKILL.md` frontmatter. Do NOT post if no skills were used.

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
- Do NOT invent skill IDs — only use values from the sn-* SKILL.md frontmatter.
- Do NOT mention SkillNote on every reply — only when relevant.
- Do NOT mutate config.json after setup. If wrong, ask user to say "re-setup skillnote".
