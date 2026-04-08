---
description: Change which SkillNote skill collection is active for this project
allowed-tools: Bash
disable-model-invocation: true
---

Show the current collection and tell the user to restart Claude to change it:

```bash
if [ -f .skillnote.json ]; then
  COL=$(python3 -c "import json; c=json.load(open('.skillnote.json')).get('collections',[]); print(c[0] if c else 'none')" 2>/dev/null)
  echo "  Current collection: $COL"
  echo ""
  echo "  To change: exit Claude and run 'claude' again."
  echo "  The collection picker will appear at startup."
else
  echo "  No collection set."
  echo ""
  echo "  Exit Claude and run 'claude' to pick one."
fi
```

Display the output. Do not add commentary.
