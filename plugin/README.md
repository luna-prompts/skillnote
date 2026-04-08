# SkillNote Plugin for Claude Code

Connect your [SkillNote](https://github.com/luna-prompts/skillnote) skill registry to Claude Code. Skills sync per-project with full Claude Code features (allowed-tools, context: fork, effort, model), usage is tracked automatically, and agents can create new skills from conversations.

## Install

```bash
curl -sf http://localhost:8082/setup | bash
source ~/.zshrc
```

## What It Does

- **Collection picker**: Full-screen terminal UI to choose which skills to activate per project
- **SessionStart hook**: Syncs selected collection to `PROJECT/.claude/skills/` with full frontmatter
- **Background re-sync**: UserPromptSubmit hook checks for updates every 60s (non-blocking)
- **Usage tracking**: PostToolUse hook posts skill invocations to SkillNote analytics
- **Context persistence**: PostCompact and SubagentStart hooks re-inject skill context
- **Skill push**: Create new skills from conversations using `/skillnote:skill-push`

## Per-Project Scoping

Skills are always project-level. No skills sync until you pick a collection. The picker writes `.skillnote.json` to the project root:

```json
{"collections": ["frontend", "conventions"]}
```

Without this file, no skills are synced. Run the picker again to change collections.

## Manual Sync

```bash
skillnote-sync          # trigger sync manually
skillnote-sync --force  # force re-sync (clears manifest)
```

## Requirements

- SkillNote server running and reachable
- Claude Code 2.1+ (plugin and hook support)
- Python 3, curl
