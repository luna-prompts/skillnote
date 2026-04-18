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
- Build `options` in this order:
  1. **Recommended first:** if `basename(cwd)` (lowercase, non-alphanumeric replaced with `-`) matches an existing collection name, put that option first and append ` · Recommended` to its description. Example description: `"12 skills · Recommended"`.
  2. All other existing collections, each with `label` = name, `description` = `"{count} skills"`.
  3. **If `.skillnote.json` exists**, add "(current)" to the currently-active collection's label.
  4. `{"label": "Create new collection…", "description": "type a name next"}`
  5. `{"label": "Skip (use no collections)", "description": "no skills synced"}`

Example AskUserQuestion call:
```json
{
  "header": "SkillNote",
  "question": "Pick a collection for this project:",
  "options": [
    {"label": "frontend (current)", "description": "12 skills · Recommended"},
    {"label": "backend", "description": "8 skills"},
    {"label": "devops", "description": "3 skills"},
    {"label": "Create new collection…", "description": "type a name next"},
    {"label": "Skip (use no collections)", "description": "no skills synced"}
  ]
}
```

## Step 3: Apply selection

Branch based on what the user picked:

### 3a. Existing collection or "(current)" option
Strip any ` (current)` suffix. Then run:

```bash
echo '{"collections": ["<SELECTED_NAME>"]}' > .skillnote.json
skillnote-sync --force 2>/dev/null || true
```

Tell the user: "Switched to {name}. Skills will refresh."

### 3b. "Create new collection…"
Ask the user for a name in a plain text turn:

> What should the new collection be called? (lowercase letters, numbers, hyphens, underscores — example: `my-project`)

Wait for their reply. Validate: name must match `^[a-z0-9_-]+$`, be 1–128 chars, and not contain `anthropic` or `claude`. If invalid, explain and re-prompt once.

Create the collection:

```bash
curl -sf -X POST "http://${CLAUDE_PLUGIN_OPTION_HOST:-localhost}:8082/v1/collections" \
  -H "Content-Type: application/json" \
  -d '{"name": "<NAME>", "description": ""}'
```

If curl returns a 409 conflict, the collection already exists — tell the user and offer to activate it instead (one-question AskUserQuestion: `Yes, activate / No, pick a different name`).

On success, write the name to `.skillnote.json` and run sync the same way as 3a.

### 3c. "Skip (use no collections)"
Write an empty collections list:

```bash
echo '{"collections": []}' > .skillnote.json
skillnote-sync --force 2>/dev/null || true
```

Tell the user: "Skipped. No skills will be synced to this project."

## Rules

- ALWAYS use AskUserQuestion — never print a table or numbered list
- Keep 12-15 skills per collection for best Claude Code performance
- User can change collections anytime by saying "change collection"
