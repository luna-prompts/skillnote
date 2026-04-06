---
name: collection
description: Choose which SkillNote skill collection is active for this project. Use when user says "change collection", "switch skills", "use frontend skills", "show collections", or at first session in a new project when recommended.
---

# SkillNote Collection Manager

Help the user choose which skill collection to sync for the current project.

## Step 1: Fetch Collections

```python
import urllib.request, json, os
api = f"http://{os.environ.get('CLAUDE_PLUGIN_OPTION_HOST', 'localhost')}:8082"
try:
    cols = json.loads(urllib.request.urlopen(f"{api}/v1/collections").read())
    for c in cols:
        print(f"{c['name']} ({c['count']} skills)")
except Exception as e:
    print(f"Error: {e}")
```

## Step 2: Ask the User

Use **AskUserQuestion** to present the collections as a picker. The user selects with arrow keys.

Rules for building the question:
- Use `multiSelect: true` so the user can pick multiple collections
- Show up to 4 collections (the tool limit) — pick the ones with the most skills
- If a collection was recommended by SkillNote (from the session start message), mark it as "(Recommended)" and put it first
- Always include an option for "All skills (no filter)"
- Keep labels to 1-5 words, put skill count in the description

Example:
```
Use AskUserQuestion with:
  header: "Skills"
  question: "Which collections should be active for this project?"
  multiSelect: true
  options:
    - label: "frontend (Recommended)"
      description: "12 skills for React, Next.js, TypeScript patterns"
    - label: "conventions"  
      description: "5 skills for coding standards and style rules"
    - label: "backend"
      description: "8 skills for Python, FastAPI, database patterns"
    - label: "All skills"
      description: "No filter — sync everything from the registry"
```

## Step 3: Apply the Selection

Based on the user's answer:

**If they picked specific collections:**
```python
import json
collections = ["frontend", "conventions"]  # from their selection
with open(".skillnote.json", "w") as f:
    json.dump({"collections": collections}, f, indent=2)
    f.write("\n")
print(f"Set: {collections}")
```

**If they picked "All skills":**
```bash
rm -f .skillnote.json
```

Tell the user: "Collection set. Skills will update within 60 seconds, or run `skillnote-sync` to sync now."

## Step 4: Trigger Immediate Sync (optional)

If `skillnote-sync` is available in PATH:
```bash
skillnote-sync --force
```

## Guidelines

- Keep **12-15 skills per collection** for best Claude Code performance
- The skill description budget is ~8,000 chars shared across ALL skills and plugins
- Too many skills = descriptions get silently truncated = skills stop triggering
- The user can change collections anytime by saying "change collection" or running this skill
