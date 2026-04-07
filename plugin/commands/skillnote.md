---
description: SkillNote dashboard — see active collection, skills, and available commands
allowed-tools: Bash
disable-model-invocation: true
---

Show the SkillNote dashboard. Run this single command and display its output:

```bash
echo ""
echo "  ● SkillNote"
echo ""

# Active collection
if [ -f .skillnote.json ]; then
  COL=$(python3 -c "import json; c=json.load(open('.skillnote.json')).get('collections',[]); print(c[0] if c else 'none')" 2>/dev/null)
  echo "  Collection:  $COL"
else
  echo "  Collection:  (none — run /skillnote:collection to pick)"
fi

# Synced skills
if [ -d .claude/skills ]; then
  SKILLS=$(ls -d .claude/skills/skillnote-*/ 2>/dev/null | xargs -I{} basename {} | sed 's/^skillnote-//' | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g')
  COUNT=$(ls -d .claude/skills/skillnote-*/ 2>/dev/null | wc -l | tr -d ' ')
  echo "  Skills:      $COUNT ($SKILLS)"
else
  echo "  Skills:      0"
fi

# Web URL
HOST="${CLAUDE_PLUGIN_OPTION_HOST:-localhost}"
if [ -z "$HOST" ] || [ "$HOST" = "localhost" ]; then
  [ -f "$HOME/.skillnote/host" ] && HOST=$(cat "$HOME/.skillnote/host")
fi
echo "  Web UI:      http://${HOST:-localhost}:3000/collections"
echo ""
echo "  Commands:"
echo "    /skillnote:collection    Change active collection"
echo "    /skillnote:skill-push    Create & push a new skill"
echo ""
echo "  GitHub:  github.com/luna-prompts/skillnote  ★ Star us!"
echo ""
```

Display the output as-is. Do not add commentary.
