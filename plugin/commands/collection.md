---
description: Choose which SkillNote skill collections are active for this project
allowed-tools: Bash AskUserQuestion
---

## Step 1: Get collections

```bash
curl -sf "http://${CLAUDE_PLUGIN_OPTION_HOST:-localhost}:8082/v1/collections" 2>/dev/null || echo "[]"
```

## Step 2: Show picker

Call AskUserQuestion with:
- `header`: "SkillNote"
- `question`: "Pick a collection:"
- Build `options` from Step 1 output. Each: `label` = name, `description` = "{count} skills"
- If `.skillnote.json` exists, mark the current one with "(current)" in the label

## Step 3: Apply

```bash
echo '{"collections": ["<NAME>"]}' > .skillnote.json
skillnote-sync --force 2>/dev/null || true
```

Replace `<NAME>` with what the user picked. Tell them "Switched to {name}."
