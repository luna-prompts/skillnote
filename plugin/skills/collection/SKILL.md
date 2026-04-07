---
name: collection
description: Choose which SkillNote skill collection is active for this project. Use when user says "change collection", "switch skills", "use frontend skills", "show collections", or at first session in a new project when recommended.
allowed-tools: Bash Write Read AskUserQuestion
---

# SkillNote Collection Manager

Help the user choose which skill collection to sync for the current project.

## Step 1: Fetch collections

Run this in Bash to get available collections:

```bash
curl -sf "http://${CLAUDE_PLUGIN_OPTION_HOST:-localhost}:8082/v1/collections" 2>/dev/null || echo "[]"
```

## Step 2: Show picker — MUST use AskUserQuestion

You MUST call the AskUserQuestion tool. Do NOT print a table or ask a text question.

Call AskUserQuestion with these EXACT parameters:
- `header`: "SkillNote"
- `question`: "Pick a collection for this project:"
- Build `options` from the collections fetched in Step 1. Each option:
  - `label`: the collection name (e.g. "Conventions")
  - `description`: "{count} skills" (e.g. "4 skills")
- If `.skillnote.json` exists, add "(current)" to that collection's label

Example AskUserQuestion call:
```json
{
  "header": "SkillNote",
  "question": "Pick a collection for this project:",
  "options": [
    {"label": "Conventions (current)", "description": "4 skills"},
    {"label": "DevOps", "description": "2 skills"},
    {"label": "Official", "description": "2 skills"}
  ]
}
```

## Step 3: Apply selection

After the user picks, write `.skillnote.json` and sync:

```bash
echo '{"collections": ["<SELECTED_NAME>"]}' > .skillnote.json
skillnote-sync --force 2>/dev/null || true
```

Replace `<SELECTED_NAME>` with the actual collection name the user chose (without the "(current)" suffix).

Then tell the user: "Switched to {name}. Skills will refresh."

## Rules

- ALWAYS use AskUserQuestion — never print a table or numbered list
- Keep 12-15 skills per collection for best Claude Code performance
- User can change collections anytime by saying "change collection"
