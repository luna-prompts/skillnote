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
    if not cols:
        print("(no collections yet)")
except Exception as e:
    print(f"Error: {e}")
```

## Step 2: Let the User Choose

Use **AskUserQuestion** to present the top collections. Rules:

- Show up to **3 collections** sorted by skill count (descending)
- If a collection was recommended by SkillNote (from the session start message), put it first with "(Recommended)"
- The **4th option** is always: **"Browse all in browser"** — this opens the web UI with a searchable picker
- Use `multiSelect: true` so the user can pick multiple
- Keep labels to 1-5 words

Example:
```
AskUserQuestion:
  header: "Skills"
  question: "Which collections for this project?"
  multiSelect: true
  options:
    - label: "frontend (Recommended)"
      description: "12 skills — matches folder name"
    - label: "backend"
      description: "8 skills"
    - label: "conventions"
      description: "5 skills"
    - label: "Browse all in browser"
      description: "Open searchable picker with all collections"
```

## Step 3a: User Picked Collections from the Picker

Write `.skillnote.json`:

```python
import json
collections = ["frontend", "conventions"]  # from their selection
with open(".skillnote.json", "w") as f:
    json.dump({"collections": collections}, f, indent=2)
    f.write("\n")
print(f"Set: {collections}")
```

Then trigger sync:
```bash
skillnote-sync --force 2>/dev/null || true
```

## Step 3b: User Picked "Browse all in browser"

Create a pick session and open the web UI:

```python
import urllib.request, json, os, time, subprocess, sys

api = f"http://{os.environ.get('CLAUDE_PLUGIN_OPTION_HOST', 'localhost')}:8082"

# 1. Create session
req = urllib.request.Request(f"{api}/v1/sessions", method="POST", headers={"Content-Type": "application/json"})
session = json.loads(urllib.request.urlopen(req).read())
token = session["token"]
pick_url = session["pick_url"]

print(f"Open this URL to pick collections:")
print(f"  {pick_url}")
print()

# 2. Try to open browser
try:
    subprocess.Popen(["open", pick_url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
except:
    try:
        subprocess.Popen(["xdg-open", pick_url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except:
        pass  # User will open manually

# 3. Poll for result (every 3s, up to 10 minutes)
print("Waiting for your selection in the browser...")
for i in range(200):
    time.sleep(3)
    try:
        result = json.loads(urllib.request.urlopen(f"{api}/v1/sessions/{token}").read())
        if result["status"] == "completed" and result.get("collections"):
            print(f"Selected: {result['collections']}")
            # Write .skillnote.json
            with open(".skillnote.json", "w") as f:
                json.dump({"collections": result["collections"]}, f, indent=2)
                f.write("\n")
            print("Collection set!")
            break
    except:
        pass
    if i % 10 == 0 and i > 0:
        print(f"  Still waiting... ({i * 3}s)")
else:
    print("Session expired. Try again with /skillnote:collection")
```

After the selection is applied, trigger sync:
```bash
skillnote-sync --force 2>/dev/null || true
```

Tell the user what was set and that skills will refresh.

## Guidelines

- Every skill must belong to at least one collection
- Keep **12-15 skills per collection** for best Claude Code performance
- The skill description budget is ~8,000 chars shared across ALL skills and plugins
- Too many skills = descriptions get silently truncated = skills stop triggering
- The user can change collections anytime by saying "change collection"
