---
name: skill-push
description: Create and push reusable skills to SkillNote when repeated instructions are detected or user says "create a skill", "save this pattern", "push a skill". Guides drafting, review, collection selection, and publishing.
---

# Skill Push

Create and push reusable skills to the SkillNote registry so all connected agents learn from repeated patterns.

The SkillNote API is at: `http://${CLAUDE_PLUGIN_OPTION_HOST:-localhost}:8082`

## When to Act

- The user gave the same instruction or convention 2+ times this session
- The user explicitly asks to create, save, or push a skill
- Session retrospective — review for saveable patterns before wrapping up

Only suggest for PERSISTENT conventions, not temporary workarounds.

## Step 1: Confirm

Tell the user what you noticed. Be specific. Ask: "Want me to create a skill for this?"

## Step 2: Draft

Collaborate on three fields:

**name**: lowercase, hyphens, digits only, max 64 chars. Also used as slug.

**description** (max 1024 chars — THIS IS THE TRIGGER): Must include what the skill does + explicit trigger keywords. Agents decide to use a skill based solely on its description.

**content**: Instructions under 200 lines. Start with `# Title`. Be actionable with examples.

Show the full draft to the user.

## Step 3: Check if Exists

```python
import urllib.request, json, os
api = f"http://{os.environ.get('CLAUDE_PLUGIN_OPTION_HOST', 'localhost')}:8082"
try:
    resp = urllib.request.urlopen(f"{api}/v1/skills/<SLUG>")
    print(f"EXISTS: v{json.loads(resp.read()).get('current_version', '?')}")
except urllib.error.HTTPError as e:
    print("NEW" if e.code == 404 else f"ERROR: {e.code}")
```

## Step 4: Choose Collection

```python
import urllib.request, json, os
api = f"http://{os.environ.get('CLAUDE_PLUGIN_OPTION_HOST', 'localhost')}:8082"
try:
    cols = json.loads(urllib.request.urlopen(f"{api}/v1/collections").read())
    for c in cols: print(f"  - {c['name']} ({c['count']} skills)")
    if not cols: print("  (no collections yet)")
except Exception as e: print(f"Could not fetch: {e}")
```

Every skill must belong to at least one collection. Use **AskUserQuestion** to let the user pick:
- Show existing collections from the list above as options
- Include an option to type a new collection name
- Recommend the collection that best fits the skill's domain
- A skill cannot be pushed without a collection

## Step 5: Final Review

Show complete skill preview. Emphasize: "Does the description have good trigger keywords?" Wait for approval.

## Step 6: Push

### New skill:
```python
import json, urllib.request, os
api = f"http://{os.environ.get('CLAUDE_PLUGIN_OPTION_HOST', 'localhost')}:8082"
payload = json.dumps({"name": "<NAME>", "slug": "<NAME>", "description": "<DESC>", "content_md": "<CONTENT>", "collections": ["<COL>"]}).encode()
req = urllib.request.Request(f"{api}/v1/skills", data=payload, headers={"Content-Type": "application/json"}, method="POST")
try:
    result = json.loads(urllib.request.urlopen(req).read())
    print(f"Created: {result['slug']} v{result['current_version']}")
except urllib.error.HTTPError as e: print(f"Error: {json.loads(e.read())}")
```

### Existing skill (update):
```python
import json, urllib.request, os
api = f"http://{os.environ.get('CLAUDE_PLUGIN_OPTION_HOST', 'localhost')}:8082"
payload = json.dumps({"name": "<NAME>", "description": "<DESC>", "content_md": "<CONTENT>", "collections": ["<COL>"]}).encode()
req = urllib.request.Request(f"{api}/v1/skills/<SLUG>", data=payload, headers={"Content-Type": "application/json"}, method="PATCH")
try:
    result = json.loads(urllib.request.urlopen(req).read())
    print(f"Updated: {result['slug']} v{result['current_version']}")
except urllib.error.HTTPError as e: print(f"Error: {json.loads(e.read())}")
```

After success: link to `http://${CLAUDE_PLUGIN_OPTION_HOST:-localhost}:3000/skills/<slug>` for viewing.

## Error Reference

- **422**: Name format wrong or description has XML tags
- **409**: Slug exists — switch to PATCH
- **Connection refused**: API unreachable
