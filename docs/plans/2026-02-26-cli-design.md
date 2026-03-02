# SkillNote CLI Design

## Overview

`skillnote` is an NPX-based CLI that connects to a self-hosted SkillNote registry, letting developers install and update skills locally for the coding agents they use. Think `git clone` for prompt-based skills.

**Invocation:** `npx skillnote <command>`

**Package name:** `skillnote` (npm)

**Repo location:** `cli/` at the repo root, alongside `backend/` and `src/`

**Language:** TypeScript, compiled to a single ESM bundle via tsup/esbuild

**Scope:** v1 is self-hosted only — requires `--host` + token (or env vars)

---

## Architecture

**Approach:** Monolithic single-binary. One TypeScript package compiled to `dist/index.js`. All commands, agent adapters, and HTTP logic in one bundle. No plugin system in v1.

**Dependencies (minimal):**
- `commander` — CLI framework
- `chalk` — terminal colors
- `ora` — spinners
- Node built-ins: `fs`, `path`, `crypto`, `os`, `fetch`

---

## Project Structure

```
cli/
├── package.json          # name: "skillnote", bin: { skillnote: "./dist/index.js" }
├── tsconfig.json
├── tsup.config.ts        # single ESM entry -> dist/index.js
├── src/
│   ├── index.ts          # #!/usr/bin/env node + commander setup
│   ├── commands/
│   │   ├── login.ts
│   │   ├── list.ts
│   │   ├── add.ts
│   │   ├── check.ts
│   │   ├── update.ts
│   │   ├── remove.ts
│   │   └── doctor.ts
│   ├── api/
│   │   └── client.ts     # HTTP client wrapping fetch() for the backend API
│   ├── agents/
│   │   ├── types.ts       # AgentAdapter interface
│   │   ├── claude.ts
│   │   ├── cursor.ts
│   │   ├── codex.ts
│   │   ├── openclaw.ts
│   │   ├── openhands.ts
│   │   └── universal.ts
│   ├── manifest/
│   │   └── index.ts       # Read/write .skillnote/manifest.json
│   ├── config/
│   │   └── index.ts       # Read/write ~/.skillnote/config.json
│   └── util/
│       ├── checksum.ts    # SHA-256 verification
│       ├── zip.ts         # Safe extraction (no path traversal)
│       └── ui.ts          # chalk + ora wrappers
```

---

## Commands

### `skillnote login --host <url>`

1. Prompt for token (masked input, or accept `--token` flag / `SKILLNOTE_TOKEN` env var)
2. Call `POST /auth/validate-token` to verify
3. Save to `~/.skillnote/config.json`: `{ "host": "...", "token": "..." }`
4. Print: `Logged in to skills.myorg.com as user (seed-user)`

### `skillnote list`

1. Read config, call `GET /v1/skills`
2. For each skill, show latest version and install status (check manifest)
3. Output table:
   ```
   NAME                  VERSION   STATUS      TAGS
   secure-migrations     0.1.0     installed   database, devops
   prompt-engineering    1.2.0     available   writing
   code-review           2.0.1     outdated    quality
   ```

### `skillnote add <skill> [--agent <name>] [--all]`

1. Resolve skill slug -> call `GET /v1/skills/{slug}/versions` -> pick latest `active` version
2. Call `GET /v1/skills/{slug}/{version}/download` -> stream ZIP to temp file
3. Verify SHA-256 from `X-Checksum-Sha256` header against downloaded file
4. Extract ZIP to temp dir, validate (no `../`, no absolute paths)
5. Detect installed agents (or use `--agent` flag) -> for each agent:
   - Copy extracted contents to agent's skill directory
6. Update `.skillnote/manifest.json`:
   ```json
   {
     "skills": {
       "secure-migrations": {
         "version": "0.1.0",
         "checksum": "abc123...",
         "installedAt": "2026-02-26T...",
         "agents": ["claude", "cursor"]
       }
     }
   }
   ```
7. Print success with installed path(s)

`--all` repeats for every skill returned by `GET /v1/skills`.

### `skillnote check`

1. Read manifest, for each installed skill:
2. Call `GET /v1/skills/{slug}/versions` -> compare latest active version vs installed
3. Output:
   ```
   secure-migrations     0.1.0 -> 0.2.0   update available
   prompt-engineering    1.2.0 -> 1.2.0   up to date
   ```

### `skillnote update <skill> [--all]`

1. Same as `add` but for already-installed skills
2. Shows `0.1.0 -> 0.2.0` diff
3. Overwrites existing files atomically (extract to temp, then move)

### `skillnote remove <skill>`

1. Read manifest, find skill entry
2. For each agent it was installed to: delete the skill directory
3. Remove from manifest
4. Print confirmation

### `skillnote doctor`

Runs comprehensive checks with pass/fail indicators:
- Backend reachable (`GET /health`)
- Token valid (`POST /auth/validate-token`)
- Node.js version >= 18
- Agents detected (scan for `.claude/`, `.cursor/`, `~/.openclaw/`, etc.)
- Installed skills: files exist on disk
- Installed skills: checksums match manifest
- Disk space available
- Config file permissions (not world-readable)

---

## Agent Adapters

```typescript
interface AgentAdapter {
  name: string                        // "claude", "cursor", "codex", etc.
  displayName: string                 // "Claude Code", "Cursor", etc.
  detect(): boolean                   // Does this agent exist in current project/system?
  skillDir(skillSlug: string): string // Where to install a skill
  postInstall?(skillSlug: string): void // Optional agent-specific setup
}
```

### Agent Install Paths (project-scoped by default)

| Agent | Detect By | Install To |
|-------|-----------|------------|
| **Claude Code** | `.claude/` dir exists | `.claude/skills/{slug}/` |
| **Cursor** | `.cursor/` or `.cursorrules` exists | `.cursor/skills/{slug}/` |
| **Codex** | `.codex/` dir exists | `.codex/skills/{slug}/` |
| **OpenClaw** | `~/.openclaw/` dir exists | `skills/{slug}/` (workspace root) |
| **OpenHands** | `.openhands/` dir exists | `.openhands/skills/{slug}/` |
| **Universal** | Always available as fallback | `.agents/skills/{slug}/` |

### Detection Logic

1. If `--agent claude` specified -> use only that adapter
2. Otherwise scan project root for agent markers
3. If no agents detected -> prompt user to pick, or default to Universal

---

## State Storage

**Global config:** `~/.skillnote/config.json`
```json
{
  "host": "https://skills.myorg.com",
  "token": "skn_live_..."
}
```

**Per-project manifest:** `.skillnote/manifest.json`
```json
{
  "skills": {
    "secure-migrations": {
      "version": "0.1.0",
      "checksum": "abc123...",
      "installedAt": "2026-02-26T10:30:00Z",
      "agents": ["claude", "cursor", "openclaw"]
    }
  }
}
```

---

## Security

### SHA-256 Verification
1. Download ZIP -> compute `crypto.createHash('sha256')` on raw bytes
2. Compare against `X-Checksum-Sha256` response header
3. Mismatch -> abort, delete temp file, print error with both hashes

### Safe ZIP Extraction
- Reject entries with `../` or absolute paths
- Extract to `os.tmpdir()/skillnote-{random}/` first
- Validate, then atomic `fs.rename()` to final destination

### Atomic Installs
- Never write directly to agent skill dirs
- Always: temp dir -> extract -> verify -> rename to final path
- If rename fails (cross-device), fall back to copy + delete temp

---

## Error Handling

```
x Checksum mismatch for secure-migrations@0.1.0
  Expected: abc123...
  Got:      def456...

x Backend unreachable at https://skills.myorg.com
  Run `skillnote doctor` for diagnostics.

x Token expired -- run `skillnote login` to re-authenticate.
```

**Partial failure on `--all`:** Continue remaining, print summary: `3 installed, 1 failed`

---

## Non-Interactive / CI Mode

`-y/--yes` flag skips all prompts. Env vars for auth:
```bash
SKILLNOTE_HOST=https://skills.myorg.com SKILLNOTE_TOKEN=skn_live_... npx skillnote add --all -y
```

---

## Backend API Endpoints Used

| Command | Endpoint |
|---------|----------|
| `login` | `POST /auth/validate-token` |
| `list` | `GET /v1/skills` |
| `add` | `GET /v1/skills/{slug}/versions` + `GET /v1/skills/{slug}/{version}/download` |
| `check` | `GET /v1/skills/{slug}/versions` (per installed skill) |
| `update` | Same as `add` |
| `doctor` | `GET /health` + `POST /auth/validate-token` |

All endpoints require `Authorization: Bearer {token}` except `/health` and `/auth/validate-token`.
