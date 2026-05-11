# skillnote

Self-hosted skill registry for AI coding agents — `npx skillnote start` and you're running.

## Quick start

```bash
# 1. Install Docker Desktop (or Docker Engine + Compose v2)
# 2. Run:
npx skillnote start
# 3. Open the URL it prints (default: http://localhost:3000)
```

That's it. The CLI pulls the SkillNote images, brings up the stack, waits for health, and opens the web UI in your browser on first run.

## What it does

- Boots the full SkillNote stack (web + API + Postgres) on your machine with a single command.
- Manages the lifecycle of those containers — start, stop, restart, tail logs, check status.
- Stores skills in your own Postgres volume. Nothing leaves the host.
- Wraps `docker compose` so you don't have to think about compose files, ports, or healthchecks.

## Lifecycle commands

| Command | Description |
| --- | --- |
| `skillnote start` | Pull images (if needed), bring the stack up, wait for health, open the web UI on first run. |
| `skillnote stop` | Stop the stack. Data volumes are preserved by default. Pass `--remove-volumes` to also wipe the database. |
| `skillnote restart` | Stop and start. Useful after editing `~/.skillnote/config.json` or changing port overrides. |
| `skillnote status` | Show service health (web, api, postgres) and the URLs they're listening on. `--json` for scripts. |
| `skillnote logs [service]` | Tail logs from one service or all of them. `-f` to follow, `-t <n>` to set tail length. |
| `skillnote open` | Open the web UI in your default browser. `--app` for chromeless mode, `--print` to just print the URL. |

Running `npx skillnote` with no subcommand is an alias for `skillnote start`.

## Agent connect commands

These commands wire SkillNote into the AI coding agents on your machine. They are scheduled for Phase 2B of the v0.5 series and are not yet wired up — the table below describes the intended surface.

| Command | Description |
| --- | --- |
| `skillnote connect <agent>` | Install the SkillNote integration for an agent (Claude Code, Cursor, Codex, OpenClaw, etc.). Detects the agent's config directory, writes the integration files, and verifies the agent can reach the registry. |
| `skillnote disconnect <agent>` | Remove the SkillNote integration from an agent. Reverses what `connect` wrote. Leaves the registry itself running. |
| `skillnote reconnect <agent>` | Re-run `connect` against a clean slate. Useful after the agent updates and overwrites the integration, or after a SkillNote upgrade changes the integration shape. |

In the meantime, the v0.4 file-push commands (`login`, `list`, `add`, `update`, `check`, `remove`, `doctor`) are still available as subcommands and continue to work. See the [migration guide](https://github.com/luna-prompts/skillnote/blob/master/MIGRATION-v0.5.md) for the rename plan.

## Configuration

User config lives at `~/.skillnote/config.json`. It's created on first run with defaults; edit it freely and run `skillnote restart` to pick up changes. Fields:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `host` | URL | `http://localhost:8082` | The registry the CLI talks to. Override per-call with `--host` on commands that accept it. |
| `webPort` | number | `3000` | Host port for the web UI. |
| `apiPort` | number | `8082` | Host port for the API. |
| `browserMode` | `default` \| `app` \| `none` | `default` | What `start` (first run) and `open` do. `app` opens chromeless on Chrome/Edge; `none` never opens a browser. |
| `updateCheck` | boolean | `true` | Whether `start` checks npm for a newer CLI version. |
| `telemetry` | boolean | `false` | Opt-in only; off by default. |

Per-invocation flags (`--web-port`, `--api-port`, `--no-browser`, `--no-pull`) override config without rewriting the file.

Runtime state — lock file, session token, last-start timestamp — also lives under `~/.skillnote/`. Delete the directory to fully reset.

## Requirements

- Node 20 or newer (the CLI is published as ESM).
- Docker Engine with the `docker compose` v2 plugin. The legacy `docker-compose` Python binary is not supported.
- Free TCP ports 3000 and 8082 by default, or override with `--web-port` / `--api-port`.

## Links

- Main repo and full docs: <https://github.com/luna-prompts/skillnote>
- Issues: <https://github.com/luna-prompts/skillnote/issues>
- Migration from v0.4: <https://github.com/luna-prompts/skillnote/blob/master/MIGRATION-v0.5.md>

## License

MIT
