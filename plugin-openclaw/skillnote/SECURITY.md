# SkillNote skill — security & behavior reference

This file documents every privileged action this skill bundle performs, what
data it touches, and what it does NOT do. It exists so static analyzers,
security reviewers, and curious users can verify the skill's behavior
without reading every line of code.

Source: https://github.com/luna-prompts/skillnote/tree/master/plugin-openclaw/skillnote

## Files installed by this bundle

```
~/.openclaw/skills/skillnote/SKILL.md            agent instructions (always: true)
~/.openclaw/skills/skillnote/sync.sh             sync + daemon launcher (executable)
~/.openclaw/skills/skillnote/log-watcher.py      analytics daemon
~/.openclaw/skills/skillnote/config.template.json  config skeleton
~/.openclaw/skills/skillnote/VERSION             local version marker for self-update
```

## Files this bundle creates at runtime

| Path | Created by | Purpose |
|---|---|---|
| `~/.openclaw/skills/skillnote/config.json` | SKILL.md Step 3 (agent writes after asking user) | Stores resolved registry URL + user_id |
| `~/.openclaw/skills/sn-<slug>/SKILL.md` | sync.sh (every 60s) | Mirrors of registry skills, one dir per slug |
| `~/.openclaw/skills/skillnote/.last-sync-time` | sync.sh | Sync throttle marker |
| `~/.openclaw/skills/skillnote/.last-version-check` | sync.sh | Self-update throttle marker (24h) |
| `~/.openclaw/skills/skillnote/.log-watcher-state.json` | log-watcher.py | Tracks file offsets + seen skill slugs for dedup |
| `~/.openclaw/skills/skillnote/.log-watcher.log` | sync.sh (stderr redirect of daemon) | Daemon stderr log |
| `~/.openclaw/skills/skillnote/.sync.lock/` | sync.sh | Single-writer mkdir lock |
| `~/.openclaw/skillnote-agents.md` | sync.sh (every 60s, if not opted out) | Sidecar with the agent instructions the user `@include`s once |

## Files this bundle does NOT modify

- `~/.openclaw/workspace/AGENTS.md` — never auto-edited. User adds one `@include` line manually during Step 5 setup with explicit consent.
- `~/.zshrc`, `~/.bashrc`, any other shell rc file — never touched.
- Any file outside `~/.openclaw/` — never touched.

## Network behavior

All network requests go to a single user-configured host (`config.json` → `host`, default `http://localhost:8082`). The host is the user's own self-hosted SkillNote backend. Endpoints called:

| Method + path | Frequency | Purpose | Payload |
|---|---|---|---|
| `GET /v1/skills?limit=1` | On agent setup once | Reachability check | none |
| `GET /v1/skills` | Every 60s (sync.sh) | Fetch skill catalog | none |
| `GET /v1/openclaw-skill` | Every 24h (sync.sh) | Self-update version check | none |
| `POST /v1/hooks/skill-used` | Per skill read (log-watcher.py) | Implicit analytics event | `{skill_slug, session_id, agent_name}` |

The bundle posts:
- The slug of which sn-* skill the agent read (e.g., `error-handling`)
- The OpenClaw session id from the JSONL file being parsed
- The agent identity (derived from `~/.openclaw/agents/<name>/sessions/` path)

The bundle does NOT post:
- Message content (user prompts or agent responses)
- Tool call arguments or results beyond skill read paths
- Environment variables, credentials, file contents outside SKILL.md
- Any data from outside `~/.openclaw/agents/*/sessions/*.jsonl`

## What log-watcher.py reads

Walks `~/.openclaw/agents/*/sessions/*.jsonl`. Pattern-matches exactly one event type:

```json
{"type":"message","message":{"content":[
  {"type":"toolCall","name":"read","arguments":{"path":".../sn-<slug>/SKILL.md"}}
]}}
```

Skips files matching `.trajectory.` or `.reset.`. Records `(file_path, file_offset, seen_skill_slugs, session_id)` so each skill read fires at most once per session.

`mtime-based dedup-across-restarts` heuristic: on first observation of a file, if file mtime predates the daemon's start time, the daemon skips to EOF (file pre-existed; events almost certainly fired in a previous daemon lifecycle). Otherwise reads from offset 0.

## What sync.sh does

1. Reads `~/.openclaw/skills/skillnote/config.json` → `host` (env var override possible)
2. Daily: `GET <host>/v1/openclaw-skill` to check skill version; if newer than local `VERSION`, invokes `clawhub install skillnote@<ver> --yes` or overwrites SKILL.md from server
3. Every 60s: `GET <host>/v1/skills`, mirrors each skill into `~/.openclaw/skills/sn-<slug>/SKILL.md` (using a single-writer mkdir lock); removes stale `sn-*` dirs not present in the manifest
4. Launches `log-watcher.py` daemon if not already running (pgrep check, no PID file)
5. Writes `~/.openclaw/skillnote-agents.md` sidecar (unless `{"grafted": false}` in config)

What sync.sh does NOT do:
- Modify the user's AGENTS.md (this is intentional; v0.4.0 did this, v0.4.1 stopped — see commit log)
- Run network requests against any host besides the configured one
- Spawn subprocesses besides the log-watcher daemon
- Write PID files or other persistence markers beyond the listed state files

## Opt-out

Set `{"grafted": false}` in `~/.openclaw/skills/skillnote/config.json` to stop sync.sh from writing `~/.openclaw/skillnote-agents.md`. The skill still syncs the catalog and tracks reads; only the sidecar generation is skipped.

## Reporting issues

- Security concerns: open a GitHub issue at https://github.com/luna-prompts/skillnote/issues with `[security]` prefix.
- ClawHub moderation flags: file at https://github.com/openclaw/clawhub/issues with link to the affected skill version.
