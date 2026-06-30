---
name: skillnote
description: Show the active SkillNote collection and the skills synced into this project for Codex. Use when the user says "skillnote", "what skills do I have", "show my collection", or wants a SkillNote status/dashboard.
---

# SkillNote Dashboard

Show the user their SkillNote status for this project: which collection is active, how many skills synced, and where to manage them.

## Resolve the host

```bash
HOST=$(cat ~/.skillnote/host 2>/dev/null | tr -d '[:space:]'); HOST=${HOST:-localhost}
API="http://${HOST}:8082"; WEB="http://${HOST}:3000"
```

## Read the active collection

The active collection for this project is in `./.skillnote.json` (a `{"collections": [...]}` file written by the collection picker). Synced skills live in `./.codex/skills/skillnote-*/`.

```bash
cat ./.skillnote.json 2>/dev/null || echo '{"collections": []}'
ls -d ./.codex/skills/skillnote-* 2>/dev/null | sed 's#.*/skillnote-##' | sort
```

## Report

Show a compact summary:

```
● SkillNote
  Collection:  <name from .skillnote.json, or "none — run the picker">
  Skills:      <count> (<comma-separated slugs>)
  Web UI:      <WEB>/collections

  • Type /skills to invoke any synced skill
  • Say "change collection" to switch     (skillnote-collection)
  • Say "create a skill" to push a new one (skillnote-skill-push)
```

If `.skillnote.json` is missing, tell the user no collection is active yet and that the picker runs automatically when they start `codex` (or they can say "change collection" now).
