---
name: collection
description: Change which SkillNote skill collection is active for this project. Use when user says "change collection", "switch skills", "use frontend skills", or "show collections".
---

# SkillNote Collection Manager

Change which skill collection syncs for the current project.

## Show Available Collections

```python
import urllib.request, json, os
api = f"http://{os.environ.get('CLAUDE_PLUGIN_OPTION_HOST', 'localhost')}:8082"
try:
    cols = json.loads(urllib.request.urlopen(f"{api}/v1/collections").read())
    if cols:
        for c in cols:
            print(f"  {c['name']} ({c['count']} skills)")
    else:
        print("  No collections yet. Create skills with collections in the web UI.")
except Exception as e:
    print(f"  Could not fetch collections: {e}")
```

Show the list to the user and ask which collection(s) they want for this project.

## Check Current Collection

Read the current `.skillnote.json` if it exists:

```bash
if [ -f .skillnote.json ]; then
    echo "Current config:"
    cat .skillnote.json
else
    echo "No .skillnote.json — all skills sync globally."
fi
```

## Set Collection

After the user chooses, write `.skillnote.json` to the project root:

```python
import json
collections = $ARGUMENTS  # e.g., ["frontend", "conventions"]
# If user said a single name, wrap it
if isinstance(collections, str):
    collections = [c.strip() for c in collections.split(",")]
with open(".skillnote.json", "w") as f:
    json.dump({"collections": collections}, f, indent=2)
    f.write("\n")
print(f"Set collections: {collections}")
print("Skills will sync to this project's .claude/skills/ on next prompt.")
```

## Reset to Global (All Skills)

If the user wants all skills:

```bash
rm -f .skillnote.json
echo "Removed .skillnote.json — all skills will sync globally."
```

## What Happens Next

The auto-sync hook (runs every ~60 seconds) will detect the change and:
- If `.skillnote.json` exists: sync only the specified collections to `.claude/skills/` in this project
- If removed: sync all skills globally to `~/.claude/skills/`

Claude Code hot-reloads the changed SKILL.md files automatically.

## Recommendations

- Keep **12-15 skills per collection** for optimal Claude Code performance
- The skill description budget is ~8,000 chars shared across ALL skills
- Too many skills = descriptions get truncated = skills stop triggering
- Use collections to keep only relevant skills active per project
