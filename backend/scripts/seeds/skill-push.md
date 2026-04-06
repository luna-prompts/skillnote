---
name: skill-push
description: Create and push reusable skills to SkillNote when repeated instructions are detected or user says "create a skill", "save this pattern", "push a skill". Guides drafting, review, collection selection, and publishing.
---

# Skill Push

Create and push reusable skills to the SkillNote registry so all connected agents learn from repeated patterns.

## When to Act

- The user gave the same instruction or convention 2+ times this session
- The user explicitly asks to create, save, or push a skill
- Session retrospective — before wrapping up, review for saveable patterns

Only suggest for PERSISTENT conventions, not temporary workarounds. If unsure, ask.

## Step 1: Confirm the Pattern

Tell the user what you noticed. Be specific about what keeps repeating and why it would benefit from being a skill. Ask: "Want me to create a skill for this?" If no, stop.

## Step 2: Draft the Skill

Create three fields collaboratively with the user.

**name** (lowercase, hyphens and digits only, max 64 chars)
- Good: `use-absolute-imports`, `zod-validation`, `pnpm-only`
- Bad: `My Cool Skill`, names containing "anthropic" or "claude"
- The name is also used as the slug (they must be identical)

**description** (max 1024 chars — THIS IS THE TRIGGER)
The description determines when agents use this skill. It must include:
1. What the skill does (1 sentence)
2. Explicit trigger keywords (comma-separated)

Example:
> Always use absolute imports (@/...) instead of relative paths in TypeScript files. Trigger when: import, require, from, module, path.

A vague description means agents will never use the skill. Be specific and front-load trigger keywords.

**content** (the instructions, aim for under 200 lines)
- Start with `# Title`
- Be actionable with correct and incorrect examples
- Reference specific file paths if project-specific

Show the full draft to the user before proceeding.

## Step 3: Check if Skill Already Exists

Before creating, check if a skill with this slug already exists:

```python
import urllib.request, json
try:
    resp = urllib.request.urlopen("{{API_URL}}/v1/skills/<SLUG>")
    existing = json.loads(resp.read())
    print(f"EXISTS: v{existing.get('current_version', '?')}")
except urllib.error.HTTPError as e:
    if e.code == 404:
        print("NEW")
    else:
        print(f"ERROR: {e.code}")
```

- If NEW, proceed to Step 4
- If EXISTS, tell user: "This skill already exists at version N. Want to update it?" If yes, proceed (will use PATCH instead of POST)

## Step 4: Choose a Collection

Fetch available collections:

```python
import urllib.request, json
try:
    resp = urllib.request.urlopen("{{API_URL}}/v1/collections")
    cols = json.loads(resp.read())
    for c in cols:
        print(f"  - {c['name']} ({c['count']} skills)")
    if not cols:
        print("  (no collections yet)")
except Exception as e:
    print(f"Could not fetch collections: {e}")
```

Every skill must belong to at least one collection. Present options to the user:
- Existing collections from the list above (show as dropdown-style options)
- Option to type a new collection name
- Recommend the collection that best fits the skill's domain

A skill cannot be pushed without a collection. Keep 12-15 skills per collection for best Claude Code performance.

## Step 5: Final Review

Show the complete skill one final time:

```
Name:         <name>
Description:  <description>
Collections:  <collections or "global (none)">

Content preview:
---
<full content>
---

This will appear as a tool to all connected agents.
Does the description have good trigger keywords?

Ready to push?
```

Wait for explicit approval. Do not push without it.

## Step 6: Push

Use Python to construct and send the payload. This handles JSON escaping of markdown content safely.

### For a NEW skill:

```python
import json, urllib.request

payload = json.dumps({
    "name": "<NAME>",
    "slug": "<NAME>",
    "description": "<DESCRIPTION>",
    "content_md": "<CONTENT>",
    "collections": ["<COLLECTION>"]
}).encode()

req = urllib.request.Request(
    "{{API_URL}}/v1/skills",
    data=payload,
    headers={"Content-Type": "application/json"},
    method="POST"
)
try:
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read())
    print(f"Created: {result['slug']} v{result['current_version']}")
except urllib.error.HTTPError as e:
    error = json.loads(e.read())
    print(f"Error: {error}")
```

### For an EXISTING skill (update):

```python
import json, urllib.request

payload = json.dumps({
    "name": "<NAME>",
    "description": "<DESCRIPTION>",
    "content_md": "<CONTENT>",
    "collections": ["<COLLECTION>"]
}).encode()

req = urllib.request.Request(
    "{{API_URL}}/v1/skills/<SLUG>",
    data=payload,
    headers={"Content-Type": "application/json"},
    method="PATCH"
)
try:
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read())
    print(f"Updated: {result['slug']} v{result['current_version']}")
except urllib.error.HTTPError as e:
    error = json.loads(e.read())
    print(f"Error: {error}")
```

## After Success

Tell the user:
- "Skill '<name>' is live!"
- View/edit at: {{WEB_URL}}/skills/<slug>
- "Connected agents will see it in their next session"
- Track usage at: {{WEB_URL}}/analytics

## Multiple Patterns

If you noticed several patterns, batch them:

"I noticed N patterns this session:
1. <pattern> (seen N times)
2. <pattern> (seen N times)

Want me to create skills for any? All of them?"

Process each accepted pattern through Steps 2-6.

## Improving Existing Skills

If a user's instruction contradicts an existing skill, suggest updating it rather than creating a new one. Use the PATCH path in Step 6.

## Error Handling

- **422 (validation)**: Name format wrong or description has XML tags. Fix and retry.
- **409 (duplicate)**: Slug exists. Switch to PATCH update flow.
- **Connection refused**: API unreachable. Tell user to check that SkillNote backend is running.
- **Collections not loading**: Skip collection selection, push as global. Suggest adding collections later via the web UI.

## Notes

- `name` and `slug` must be identical
- `name` must match `^[a-z0-9-]+$` (no uppercase, spaces, underscores)
- `name` cannot contain "anthropic" or "claude"
- `description` cannot contain XML tags (like `<b>` or `<div>`)
- Keep skill content under 500 lines for optimal agent performance
- For complex skills needing eval loops, suggest the `skill-creator` skill instead
