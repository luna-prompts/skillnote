---
name: skillnote-awareness
description: SkillNote registry awareness — teaches when to consult SkillNote and how to spawn the resolver subagent. Always-injected meta-skill.
metadata:
  openclaw:
    always: true
  skillnote_awareness_version: "1.0.0"
---

# What is SkillNote?

SkillNote is the user's self-hosted skill registry. It lives at `{{HOST}}` and stores every skill the user has authored or imported — name, description, body, ratings, comments, and usage history. Skills are grouped into collections (e.g. "customer-support", "code-review") that scope what's relevant to the current task. SkillNote does not run inside you; you call it over HTTP. The web UI for the human is `{{WEB_URL}}` — that's where they curate skills, read your reflections, and see what you've been doing. Treat SkillNote as long-term memory that survives across sessions and agents.

# When to consult SkillNote

Call the `skillnote-resolver` subagent (defined elsewhere in this bundle) when ANY of these are true:

- The user asks for help with a task that may benefit from a saved procedure.
- The user names a domain ("I'm doing customer support today", "let's review my pull requests", "help me triage incidents").
- The user complains you forgot a procedure or did it wrong last time.
- The user mentions a skill by name (e.g. "use my pr-review skill").
- The user starts a new workspace, repo, or channel where context shifts.

Do NOT call the resolver when ANY of these are true:

- Trivial chat or one-line acknowledgment ("ok", "thanks", "got it").
- A file edit is already in flight and the user is just iterating.
- The user explicitly says "no skills", "skip skillnote", or similar.
- Pure greeting / small talk with no task.
- You already resolved skills for this same task in the last few turns and nothing changed.

The check should take you under 2 seconds. If in doubt and the task is non-trivial, resolve.

# How to consult SkillNote

Spawn the `skillnote-resolver` subagent with a JSON input:

```json
{
  "task_summary": "<one-sentence paraphrase of what the user wants>",
  "channel": "<telegram|slack|cli|web>",
  "workspace": "<repo name, channel name, or 'global'>",
  "task_context": "<2-3 sentences of relevant context, no raw user msg>"
}
```

Wait for the resolver's structured JSON output:

```json
{
  "selected_collection": "<collection_id or null>",
  "selected_skill_ids": ["<uuid>", "..."],
  "confidence": 0.0,
  "risk_level": "low|medium|high",
  "needs_user_confirmation": false,
  "reason": "<why these were chosen>",
  "missing_capability": "<gap description or null>",
  "suggest_marketplace_search": false
}
```

Decision rules:

- If `confidence < 0.6` OR `needs_user_confirmation == true`: ask the user to confirm before acting on the suggested skills.
- If `missing_capability` is set AND `suggest_marketplace_search == true`: tell the user there's a capability gap and offer to search ClawHub. Do NOT install anything without approval.
- If `risk_level == "high"`: surface the chosen skills to the user before acting.
- Otherwise: act silently using the selected skills.

# How to log usage

After acting on a task that used skills, POST to `{{HOST}}/v1/openclaw/usage`:

```json
{
  "agent_name": "openclaw-main",
  "task_summary": "<your one-sentence summary; do NOT include raw user message>",
  "collection_id": "<the resolver's selected_collection or null>",
  "skill_ids": ["<uuid>", "..."],
  "resolver_confidence": 0.82,
  "risk_level": "low",
  "outcome": "completed",
  "channel": "telegram"
}
```

Fields:

- `task_summary`: paraphrase only. The endpoint rejects payloads over 1000 chars.
- `outcome`: one of `completed`, `failed`, `abandoned`.
- `channel`: where the user is talking to you from.
- The endpoint returns `201` and an event id. Save that id; you'll use it as `linked_usage_id` when reflecting.

Hard rule: `task_summary` MUST be a paraphrase, never a verbatim user message. Strip names, emails, secrets, IDs.

# How to reflect on a skill

When you notice a skill helped, failed, was stale, or had a bug, POST to `{{HOST}}/v1/skills/<slug>/comments`:

```json
{
  "author": "openclaw-main",
  "author_type": "agent",
  "comment_type": "agent_observation",
  "rating": 4,
  "body": "<one paragraph; reference the situation, not the user>",
  "linked_usage_id": "<the id from POST /v1/openclaw/usage if recent>"
}
```

Valid `comment_type` values:

- `agent_observation` — neutral note about how the skill behaved.
- `agent_issue` — something is wrong (broken step, outdated info).
- `agent_patch_suggestion` — concrete change you'd recommend.
- `agent_success_note` — skill nailed a tricky case worth remembering.
- `agent_deprecation_warning` — skill should be retired or replaced.

Rules of thumb:

- Use comments sparingly. At most one comment per skill per day.
- Don't post "this helped" with no specifics. If you can't name what worked or broke, skip it.
- `rating` is optional. Use 1-5 only when you have signal; otherwise omit.
- Reference the situation, not the user. Never include user identity.

# When to ask the user

Default behavior is to act silently. SkillNote exists to make you faster, not to introduce friction. Confirm with the user ONLY when:

- Resolver returned `confidence < 0.6` or `needs_user_confirmation == true`.
- Two equally valid collections exist and you can't pick.
- Marketplace clone candidate (untrusted source).
- A skill requests dangerous permissions (file deletion, external messaging, money movement, credential access).
- You're about to install or modify anything on the user's system beyond writing code they asked for.

When you do ask, be specific: name the skill or collection, say what you'd do, and offer a one-tap yes/no.

# Where the user sees this

The user can browse activity, comments, ratings, and skill health at `{{WEB_URL}}`. Mention this URL ONLY when the user asks "what have you been doing?", "how do I see what skills you used?", or similar. Do NOT push the URL on every reply — that's nagging and erodes trust.

# What NOT to do

- Do NOT install marketplace skills automatically. Always offer and wait for explicit user approval.
- Do NOT POST raw user messages into `task_summary` or comment bodies — paraphrase every time.
- Do NOT log API keys, tokens, passwords, or credentials anywhere. Strip them from context before sending.
- Do NOT mutate `~/.openclaw/skillnote/config.json` at runtime; it was set at install time. If config is wrong, ask the user to re-run the installer.
- Do NOT call the resolver for trivial chat or greetings — it costs latency.
- Do NOT chain comments — one reflection per skill per day, at most.
- Do NOT invent skill IDs, collection IDs, or slugs. Only use values returned by the resolver or the API.
- Do NOT POST to `/v1/openclaw/usage` if no skills were used — usage events without skills are noise.
