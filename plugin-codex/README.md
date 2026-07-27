# SkillNote for Codex

The SkillNote plugin for [OpenAI Codex](https://developers.openai.com/codex). Auto-syncs your active SkillNote collection's `SKILL.md` files into Codex, with a session collection picker, the native `/skills` menu, and best-effort usage analytics.

This is the Codex counterpart to the Claude Code plugin in [`plugin/`](../plugin). It is delivered as a Codex plugin through a local marketplace.

## Install

The supported path is `skillnote connect codex` (or `curl -sf <host>/setup/agent | bash -s -- --agent codex`), which:

1. Downloads this bundle (host URLs baked in) from `<host>/v1/codex-bundle.zip`.
2. Extracts it into a local marketplace root under `~/.skillnote/codex/` and registers it with `codex plugin marketplace add` (the plugin is marked `INSTALLED_BY_DEFAULT`).
3. Installs the shared collection picker (`~/.skillnote/bin/skillnote-pick`) and a `codex()` shell wrapper that runs it before launching Codex.
4. Writes the resolved host to `~/.skillnote/host`.

## Layout

```
.codex-plugin/plugin.json   Manifest + interface{} branding (SkillNote logo, brand color)
hooks/hooks.json            SessionStart → sync, UserPromptSubmit → auto-sync, PostToolUse → track-usage
hooks/handlers/
  sync.sh                   Pull active collection → $PWD/.codex/skills/skillnote-<slug>/SKILL.md
  auto-sync.sh              Throttled (60s) mid-session re-sync so collection changes appear without restart
  track-usage.sh            Best-effort usage analytics → /v1/hooks/skill-used (agent_name: codex)
  resolve-host.sh           Host resolution: $SKILLNOTE_HOST → ~/.skillnote/host → localhost
skills/
  skillnote/                Dashboard: show active collection + synced skills
  collection/               Change the active collection (writes .skillnote.json)
  skill-push/               Create & push a new skill
  complete-skill/           Rate a skill after using it
assets/                     SkillNote logo + icon
```

## How sync works

- Codex runs hooks with the **session cwd** as the working directory, so handlers use `$PWD`.
- The collection picker writes `./.skillnote.json` (`{"collections": [...]}`).
- `SessionStart` runs `sync.sh`, which materializes that collection's skills into `./.codex/skills/skillnote-*/`. Codex surfaces them via `/skills` and `$skill-name`.
- `UserPromptSubmit` runs `auto-sync.sh` (async, 60s-throttled) so mid-session collection changes show up without restarting Codex.
- Sync is **project-scoped** — it never writes to global `~/.codex/skills/`.
- Offline-first: if the SkillNote server is unreachable, cached skills are kept.

## Notes

- Skill freshness is per-session/next-prompt: Codex loads skills at session start, and mid-session sync makes new skills current for subsequent turns.
- Usage analytics is best-effort — Codex's `PostToolUse` payload does not contractually carry the invoked skill's identity, so some invocations may not be counted.
