---
name: collection
description: Choose which SkillNote skill collection is active for this Codex project. Use when the user says "change collection", "switch skills", "use frontend skills", or "show collections".
---

# SkillNote Collection Manager

Help the user choose which skill collection syncs into this project. The choice is stored in `./.skillnote.json`; the plugin's sync hook materializes that collection's skills into `./.codex/skills/` on the next prompt.

## Resolve the host

```bash
HOST=$(cat ~/.skillnote/host 2>/dev/null | tr -d '[:space:]'); HOST=${HOST:-localhost}
API="http://${HOST}:8082"
```

## Step 1: Fetch collections

```bash
curl -sf "${API}/v1/collections" 2>/dev/null || echo "[]"
```

## Step 2: Present the choices

Codex has no multiple-choice tool, so present a clear numbered list in plain text and ask the user to reply with a number or name. Build the list in this order:

1. **Recommended first:** if `basename($PWD)` (lowercased, non-alphanumerics → `-`) matches an existing collection name, list it first and mark it `· recommended`.
2. All other existing collections as `<name> — <count> skills`. Mark the currently-active one (from `./.skillnote.json`) with `(current)`.
3. `Create a new collection…`
4. `Skip (no skills synced)`

Then ask: **"Which collection should this project use? (reply with a number or name)"** and wait for the reply.

## Step 3: Apply the selection

### Existing collection
```bash
echo '{"collections": ["<SELECTED_NAME>"]}' > ./.skillnote.json
rm -f ./.codex/skills/.last-sync-time   # force an immediate re-sync on the next prompt
```
Tell the user: "Switched to **<name>**. Your skills refresh on your next message — or type `/skills` after a moment."

### Create a new collection
Ask for a name in plain text. Validate: must match `^[a-z0-9_-]+$`, 1–128 chars, and must not contain `anthropic` or `claude`. Re-prompt once if invalid. Then:
```bash
curl -sf -X POST "${API}/v1/collections" \
  -H "Content-Type: application/json" \
  -d '{"name": "<NAME>", "description": ""}'
```
If curl returns 409, the collection already exists — offer to activate it instead. On success, write it to `./.skillnote.json` and reset the sync throttle exactly as above.

### Skip
```bash
echo '{"collections": []}' > ./.skillnote.json
rm -f ./.codex/skills/.last-sync-time
```
Tell the user: "Skipped. No skills will sync to this project."

## Rules

- Never invent collection names — only offer ones returned by the API (plus the create/skip options).
- Keep ~12–15 skills per collection for best agent performance.
- The user can switch anytime by saying "change collection".
