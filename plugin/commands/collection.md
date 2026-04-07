---
description: Choose which SkillNote skill collections are active for this project
allowed-tools: Bash AskUserQuestion
disable-model-invocation: true
---

## Available collections

!`curl -sf "http://${CLAUDE_PLUGIN_OPTION_HOST:-localhost}:8082/v1/collections" 2>/dev/null || echo "[]"`

## Current config

!`cat .skillnote.json 2>/dev/null || echo "none"`

## Instructions

Call AskUserQuestion with header "SkillNote", question "Pick a collection:", and options from the collections above (label=name, description="{count} skills"). Mark the current one with "(current)".

After the user picks, run:
```bash
echo '{"collections": ["<NAME>"]}' > .skillnote.json && skillnote-sync --force 2>/dev/null || true
```

Say "Switched to {name}."
