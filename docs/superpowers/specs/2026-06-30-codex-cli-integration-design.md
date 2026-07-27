# SkillNote × Codex CLI Integration — Design

> **Status note (historical document).** This is the original design spec and
> is **superseded by the `[0.7.0]` entry in `CHANGELOG.md`**, which describes
> what actually shipped. It is kept for the design rationale; where the two
> disagree, the CHANGELOG wins. Points that drifted during implementation are
> annotated inline below with **Shipped:** callouts.

**Status**: Shipped in 0.7.0
**Branch**: `feat/codex-plugin` (design was drafted on `feat/codex-integration`)
**Created**: 2026-06-30
**Goal**: Bring OpenAI Codex CLI to full parity with the Claude Code integration — collection picker, mid-session skill auto-sync, SkillNote branding, and end-to-end install via `skillnote connect codex`.

## Context

SkillNote already ships a polished Claude Code integration: a plugin (installed via a local marketplace), a pre-launch collection **picker** (`skillnote-pick`), **auto-sync** of the active collection's skills into `PROJECT/.claude/skills/` on `SessionStart` and (throttled) on `UserPromptSubmit`, usage **analytics**, and consistent **branding**.

Codex (drafted against `codex-cli 0.142.3`; the shipped integration was
verified end-to-end on `codex-cli 0.144.6`) supports the same primitives:

- **Skills**: `SKILL.md` bundles read from a user-global skill root and `<repo>/.codex/skills/` (project) — identical format to SkillNote's output. Native picker via `/skills` and `$skill-name`.
  **Shipped:** the personal root named here, `~/.codex/skills/`, is deprecated upstream; the CLI adapter (`skillnote add --agent codex`) targets **`~/.agents/skills/`** instead. Codex presence is still detected via `~/.codex`. The plugin's own sync path is unaffected — it only ever writes the project-scoped `.codex/skills/`.
- **Plugins + local marketplace**: `codex plugin marketplace add <local-path>` registers a marketplace; a plugin marked `INSTALLED_BY_DEFAULT` auto-installs. Mirrors `claude plugin marketplace add` / `claude plugin install`.
- **Bundled lifecycle hooks**: a plugin's `hooks/hooks.json` is auto-loaded when enabled, with `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` — the direct analog of Claude Code's `${CLAUDE_PLUGIN_ROOT}`. Events: `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PreCompact`, `SubagentStart`, `Stop`, etc.
- **Branding**: the `interface{}` block in `.codex-plugin/plugin.json` (`displayName`, `brandColor`, `logo`) + `assets/`.

This makes the Codex integration a near-1:1 port of the Claude Code plugin, delivered through Codex's own plugin/marketplace machinery.

Sources: https://developers.openai.com/codex/skills · https://developers.openai.com/codex/hooks · https://developers.openai.com/codex/plugins/build

## Architecture (4 layers)

### 1. `plugin-codex/` — the Codex plugin bundle

```
plugin-codex/
├── .codex-plugin/plugin.json   # manifest + interface{} branding (only this file in .codex-plugin/)
├── hooks/
│   ├── hooks.json              # SessionStart→sync, UserPromptSubmit→auto-sync(async), PostToolUse→track-usage
│   └── handlers/
│       ├── sync.sh             # pull active collection → $PWD/.codex/skills/skillnote-<slug>/SKILL.md
│       ├── auto-sync.sh        # throttled (60s) mid-session re-sync
│       ├── track-usage.sh      # best-effort usage analytics → /v1/hooks/skill-used
│       └── resolve-host.sh     # host resolution: env → ~/.skillnote/host → localhost
├── skills/
│   ├── skillnote/SKILL.md      # dashboard / status skill (replaces /skillnote slash command)
│   ├── collection/SKILL.md     # change active collection (writes .skillnote.json)
│   ├── skill-push/SKILL.md     # create & push a skill
│   └── complete-skill/SKILL.md # rate a used skill
├── assets/logo.png, icon.png   # SkillNote branding
└── README.md
```

Key adaptations from the Claude Code plugin:

- `${CLAUDE_PLUGIN_ROOT}` → `${PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` → `${PLUGIN_DATA}`.
- `CLAUDE_PROJECT_DIR` is not set by Codex; hooks run with **session cwd** as working dir, so handlers use `$PWD`.
- sync target `.claude/skills/` → `.codex/skills/`.
- `agent_name` in analytics payloads → `codex`.
- Codex plugins do not ship slash commands; the `/skillnote` dashboard becomes a bundled **skill** (`skills/skillnote/`).

### 2. Backend `setup.py`

- Add `"codex"` to `SUPPORTED_AGENTS` and `AgentLiteral`.
- `GET /v1/codex-bundle.zip` — serve `plugin-codex/` with host URLs baked in (mirrors `/v1/plugin.zip`).
- `_CODEX_SETUP_SCRIPT` + `GET /setup/codex`: download bundle → extract into a local marketplace root (`~/.skillnote/codex/marketplace/`), write `marketplace.json` (plugin marked `INSTALLED_BY_DEFAULT`), run `codex plugin marketplace add`, install the shared `skillnote-pick` + a `codex()` shell wrapper, write `~/.skillnote/host`, ping `/v1/setup/installs {agent: codex}`.
- Add `codex` to the `_AGENT_DISPATCH_SCRIPT` case statement, `_agent_status` (route through `skill_call_events`, same as claude-code), and `_AGENT_PROMPTS`.

### 3. CLI `connect.ts` / `disconnect.ts`

- Add `'codex'` to `SUPPORTED_AGENTS` + `displayNames` + a Codex "Next:" hint.
- `disconnect codex`: guided manual steps (`codex plugin marketplace remove`, remove wrapper block, `rm ~/.skillnote/host`).
  **Shipped: fully automated, not guided.** `disconnect codex` runs `codex plugin remove` + `codex plugin marketplace remove` itself, strips the shell-wrapper block, and removes `~/.skillnote/codex`. The manual command list is only printed as a fallback when the `codex` binary can't be run.

### 4. Frontend Connect page (`src/app/(app)/integrations/page.tsx`)

- Extend `AgentId` to include `'codex'` (here + `action-panel.tsx`, `agent-list-row.tsx`, `cli-jobs.ts`).
- Add a `CodexMark` icon to `agent-marks.tsx`.
- Add a Codex entry to the `AGENTS` catalog with label/sublabel/description/platforms/usageSteps.

## The picker (parity note)

The pre-launch collection picker stays a **shell wrapper** (`codex()` → runs `~/.skillnote/bin/skillnote-pick` → `command codex`), exactly as Claude Code does, because no pre-launch plugin event exists. `skillnote-pick` is agent-agnostic (writes `.skillnote.json`); it is reused verbatim. The picker sets the active collection; the plugin's `SessionStart` sync then materializes that collection's skills, which Codex surfaces via its native `/skills` picker.

## Sync model

- **SessionStart** (`matcher: "startup|resume"`): `sync.sh` writes the active collection's skills into `$PWD/.codex/skills/skillnote-<slug>/SKILL.md`, manages create/update/delete via a manifest, offline-first (silent fail using cached skills).
- **Mid-session** (`UserPromptSubmit`, async, 60s-throttled): `auto-sync.sh` re-runs `sync.sh` so collection changes appear without restarting Codex. ("mid skill sync".)
- Project-scoped only — never writes to global `~/.codex/skills/`.

## Caveats (non-blocking, documented)

1. **Analytics is best-effort.** Codex skills load as context; a `PostToolUse` event may not always carry the invoked skill's identity. The hook ships and posts when a skill name is present; robust tracking (via `~/.codex/logs_*.sqlite` / `sessions/` JSONL) is a fast-follow.
2. **Skill freshness ≈ next prompt / session.** Codex loads skills at session start; mid-session sync makes them current for subsequent turns. Matches Claude Code's session-scoped model.

## Testing

- **Backend**: unit/integration for `/setup/codex`, `/v1/codex-bundle.zip` (valid ZIP, host baked in, no symlinks), `codex` in `/v1/setup/agents`, install-ping → status `active`.
- **CLI**: vitest — `connect codex` validates against `SUPPORTED_AGENTS`, fetches `/setup/agent?agent=codex`, prints the Codex next-steps.
- **E2E (Playwright)**: Connect page shows the Codex card; connect flow renders the install command.
- **Real-codex E2E**: run `/setup/codex` against the installed `codex` CLI (shipped verification ran on **0.144.6**) — confirm `codex plugin marketplace add` registers, skills sync into `.codex/skills/`, mid-session auto-sync picks up a collection change, and `codex plugin list` shows SkillNote with branding.

## Out of scope (this cycle)

- ChatGPT / Codex cloud (web) connector — a separate cycle, analogous to the claude.ai connector.
- sqlite/session-log analytics watcher (fast-follow).
