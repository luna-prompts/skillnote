---
name: complete-skill
description: Rate a SkillNote skill after using it. Called after applying a skill to provide 1-5 rating and outcome.
user-invocable: false
allowed-tools: Bash
---

# Rate a Skill

After applying a SkillNote skill, rate how well it worked by running:

```bash
curl -sf -X POST "http://${CLAUDE_PLUGIN_OPTION_HOST:-localhost}:8082/v1/analytics/ratings" \
  -H "Content-Type: application/json" \
  -d '{"skill_slug": "$0", "rating": $1, "outcome": "$2", "agent_name": "claude-code", "session_id": "'${CLAUDE_SESSION_ID}'"}'
```

Arguments: `$0` = skill slug, `$1` = rating (1-5), `$2` = outcome description.

## Rating scale

- **5** — Perfect fit, followed instructions exactly
- **4** — Good, mostly helpful with minor adjustments
- **3** — Okay, partially useful
- **2** — Poor, unclear or wrong approach
- **1** — Not applicable or caused issues

Keep the outcome to 1-2 sentences.
