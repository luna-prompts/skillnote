---
name: skillnote-skill-push
description: Create and push reusable skills to SkillNote from Codex when repeated instructions are detected or the user says "create a skill", "save this pattern", "push a skill". Guides drafting, review, collection selection, and publishing.
---

# Skill Push

Create and push reusable skills to the SkillNote registry so every connected agent learns from repeated patterns.

## Resolve the host

```bash
HOST=$(cat ~/.skillnote/host 2>/dev/null | tr -d '[:space:]'); HOST=${HOST:-localhost}
API="http://${HOST}:8082"
```
(In Python: `host = (open(os.path.expanduser('~/.skillnote/host')).read().strip() if os.path.exists(os.path.expanduser('~/.skillnote/host')) else 'localhost')`.)

## When to Act

- The user gave the same instruction or convention 2+ times this session.
- The user explicitly asks to create, save, or push a skill.
- Session retrospective — review for saveable patterns before wrapping up.

Only suggest for PERSISTENT conventions, not temporary workarounds.

## Step 1: Confirm (REQUIRED — never skip)

**If the user did not explicitly ask to create a skill, you MUST ask first.** Tell the user what you noticed in one sentence, then ask: **"Want me to save this as a SkillNote skill?"** Wait for an explicit yes before drafting anything.

Skip this step only when the user already said "create a skill for X" / "save this pattern" / "push a skill" in their own words.

## Step 2: Draft

Collaborate on three fields:

- **name**: lowercase letters, hyphens, digits; max 64 chars. Also the slug.
- **description** (max 1024 chars — THIS IS THE TRIGGER): what the skill does + explicit trigger keywords. Agents pick a skill based solely on its description.
- **content**: instructions under ~200 lines, starting with `# Title`, actionable with examples.

Show the full draft to the user.

## Step 3: Check if it exists

```python
import urllib.request, json, os
host = open(os.path.expanduser('~/.skillnote/host')).read().strip() if os.path.exists(os.path.expanduser('~/.skillnote/host')) else 'localhost'
api = f"http://{host}:8082"
try:
    resp = urllib.request.urlopen(f"{api}/v1/skills/<SLUG>")
    print(f"EXISTS: v{json.loads(resp.read()).get('current_version', '?')}")
except urllib.error.HTTPError as e:
    print("NEW" if e.code == 404 else f"ERROR: {e.code}")
```

## Step 4: Choose a collection

```python
import urllib.request, json, os
host = open(os.path.expanduser('~/.skillnote/host')).read().strip() if os.path.exists(os.path.expanduser('~/.skillnote/host')) else 'localhost'
api = f"http://{host}:8082"
try:
    cols = json.loads(urllib.request.urlopen(f"{api}/v1/collections").read())
    for c in cols: print(f"  - {c['name']} ({c['count']} skills)")
    if not cols: print("  (no collections yet)")
except Exception as e:
    print(f"Could not fetch: {e}")
```

Every skill must belong to at least one collection. Present the list above and ask the user (plain text) which collection to use, or to type a new name. New names must match `^[a-z0-9_-]+$`, 1–128 chars, and cannot contain `anthropic` or `claude`. A skill cannot be pushed without a collection.

## Step 5: Final review

Show the complete skill preview. Emphasize: "Does the description have good trigger keywords?" Wait for approval.

## Step 6: Push

### New skill
```python
import json, urllib.request, os
host = open(os.path.expanduser('~/.skillnote/host')).read().strip() if os.path.exists(os.path.expanduser('~/.skillnote/host')) else 'localhost'
api = f"http://{host}:8082"
payload = json.dumps({"name": "<NAME>", "slug": "<NAME>", "description": "<DESC>", "content_md": "<CONTENT>", "collections": ["<COL>"]}).encode()
req = urllib.request.Request(f"{api}/v1/skills", data=payload, headers={"Content-Type": "application/json"}, method="POST")
try:
    result = json.loads(urllib.request.urlopen(req).read())
    print(f"Created: {result['slug']} v{result['current_version']}")
except urllib.error.HTTPError as e:
    print(f"Error: {json.loads(e.read())}")
```

### Existing skill (update)
```python
import json, urllib.request, os
host = open(os.path.expanduser('~/.skillnote/host')).read().strip() if os.path.exists(os.path.expanduser('~/.skillnote/host')) else 'localhost'
api = f"http://{host}:8082"
payload = json.dumps({"name": "<NAME>", "description": "<DESC>", "content_md": "<CONTENT>", "collections": ["<COL>"]}).encode()
req = urllib.request.Request(f"{api}/v1/skills/<SLUG>", data=payload, headers={"Content-Type": "application/json"}, method="PATCH")
try:
    result = json.loads(urllib.request.urlopen(req).read())
    print(f"Updated: {result['slug']} v{result['current_version']}")
except urllib.error.HTTPError as e:
    print(f"Error: {json.loads(e.read())}")
```

After success: link to `http://<host>:3000/skills/<slug>` for viewing.

## Error reference

- **422**: name format wrong or description has XML tags
- **409**: slug exists — switch to PATCH
- **Connection refused**: API unreachable (check `~/.skillnote/host`)
