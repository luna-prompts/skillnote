# SkillNote Plugin for Claude Code

Connect your [SkillNote](https://github.com/luna-prompts/skillnote) skill registry to Claude Code. Skills auto-sync with full Claude Code features (allowed-tools, context: fork, effort, model overrides), usage analytics are tracked automatically, and you can create new skills directly from conversations.

## Install

```bash
claude plugin install https://github.com/luna-prompts/skillnote-plugin --scope user
```

When prompted, enter your SkillNote server address (e.g., `<your-server-ip>` or `localhost`).

## What It Does

- **SessionStart hook**: Syncs all skills from SkillNote to `~/.claude/skills/` with full frontmatter. Skills get `allowed-tools`, `context: fork`, `effort`, and other Claude Code features.
- **Skill collection picker**: Full-screen terminal UI to choose collections at every `claude` launch.
- **Usage tracking**: Every skill invocation is automatically posted to SkillNote's analytics via a PostToolUse hook.
- **Skill push**: Create new skills from conversations using `/skillnote:skill-push` or the `/skillnote:skill-creator` agent.

## Per-Project Scoping

Add `.skillnote.json` to a project root to sync only specific collections:

```json
{"collections": ["frontend", "conventions"]}
```

Without this file, all skills sync globally.

## Manual Sync

```bash
skillnote-sync          # trigger sync manually
skillnote-sync --force  # force re-sync (clears manifest)
```

## Requirements

- SkillNote server running and reachable
- Claude Code 2.1+ (for skill hot-reload and plugin support)
- Python 3 (for sync script)
- curl (for API calls)
