# Migrating from SkillNote CLI v0.4 to v0.5

The CLI has been rewritten in v0.5. This guide is for users who installed the v0.4 series (`npm i -g skillnote@0.4`) and want to move to v0.5.

If you've never used the CLI before, skip this and just run `npx skillnote start`.

## What changed

v0.4 was a thin file-push tool. You ran a separate `./install.sh` to bring up the backend, then used the CLI to copy SKILL.md files into your AI agent's config directory:

```bash
# v0.4 flow
npm i -g skillnote
git clone https://github.com/luna-prompts/skillnote && cd skillnote && ./install.sh
skillnote login --host http://localhost:8082
skillnote add my-skill
```

v0.5 turns the CLI into the entry point for the whole product. `npx skillnote start` pulls the published Docker images, brings up the stack, waits for healthchecks, and opens the web UI — no clone, no install script:

```bash
# v0.5 flow
npx skillnote start
```

The web UI, the API, and the database all run in containers managed by the CLI. The `./install.sh` shell script in the main repo continues to work for users who prefer to manage Docker themselves.

## Breaking changes

None. The v0.4 file-push surface (`login`, `list`, `add`, `update`, `check`, `remove`, `doctor`) is still present and still works against a running backend. v0.5 adds new commands alongside them.

## What's new in v0.5

A new agent-connect surface ships alongside the v0.4 commands. The unit of action shifts from "push file Y into agent X's directory" (v0.4) to "connect agent X to the registry" (v0.5):

| New v0.5 command | Replaces (when convenient) | Notes |
| --- | --- | --- |
| `skillnote connect <agent>` | `skillnote add <skill>` for that agent | Wires the agent into your local registry — runs the canonical `/setup/agent` install. |
| `skillnote disconnect <agent>` | `skillnote remove <skill>` for that agent | Reverses what `connect` wrote (OpenClaw fully scripted; Claude Code prints a guided manual checklist). |
| `skillnote reconnect <agent>` | _(new)_ | Re-runs `connect` against a clean slate after an agent or SkillNote update. |

Phase 2C (a future minor release, no fixed date) will deprecate the v0.4 commands and eventually remove them. When that lands you'll get a deprecation warning with the equivalent v0.5 command for a full release cycle before removal. Tracking: [#40](https://github.com/luna-prompts/skillnote/issues/40).

## What's preserved

- **`skillnote doctor`** — same name, same behavior. Run it any time the CLI is misbehaving.
- **Your skills database.** v0.5 mounts the same Postgres volume name as the existing `./install.sh` stack does, so an existing local installation upgrades in place. Back up `~/.skillnote/` (and your Docker volume) before upgrading if you care about the data.
- **Your config.** `~/.skillnote/config.json` from v0.4 is read by v0.5. The v0.5 schema adds new fields (`webPort`, `apiPort`, `browserMode`, `updateCheck`, `telemetry`) with sensible defaults; existing fields are unchanged.
- **Agent integrations.** Skills you've already installed into Claude Code, Cursor, Codex, OpenHands, or OpenClaw continue to work. The integration files on disk are not touched by v0.5.

## How to migrate

1. **Back up your config.**

   ```bash
   cp ~/.skillnote/config.json ~/.skillnote/config.json.v04.bak
   ```

2. **Stop the v0.4 stack if it's running.**

   If you brought it up with `./install.sh`, leave it running — v0.5 will pick up the same containers. If you brought it up some other way, stop it now.

3. **Run v0.5.**

   ```bash
   npx skillnote@0.5 start
   ```

   First run pulls images, brings the stack up, opens the web UI. If your existing data is on the same Docker volume, it'll be visible immediately.

4. **Verify.**

   - Open the URL the CLI prints (default `http://localhost:3000`). Confirm your skills, collections, and comments are all there.
   - Run `skillnote status` in another shell. All three services should report `healthy`.
   - If you use the file-push commands, run `skillnote list` and confirm it reaches the registry.

5. **Re-connect agents (optional).**

   Your existing agent integrations keep working. If you want to reinstall them — for example to pick up new integration files shipped with v0.5 — re-run the install path you used originally (e.g. `curl -sf http://localhost:8082/setup/agent | bash -s -- --agent claude-code`). Once Phase 2B lands, `skillnote reconnect <agent>` will do this in one step.

6. **Pin the version if you want.**

   `npx skillnote@0.5 start` always grabs the latest 0.5.x. To pin to an exact version, install globally:

   ```bash
   npm i -g skillnote@0.5.0
   skillnote start
   ```

## If you need to roll back

The v0.4 CLI is still published. Install it explicitly:

```bash
npm i -g skillnote@0.4
skillnote --version   # → 0.4.x
```

Your data volume is shared, so dropping back to v0.4 doesn't lose anything. Restore your backed-up `config.json` if v0.5 rewrote it:

```bash
cp ~/.skillnote/config.json.v04.bak ~/.skillnote/config.json
```

If you hit something v0.5 broke for you, please file an issue with the v0.4 → v0.5 path you took: <https://github.com/luna-prompts/skillnote/issues>.
