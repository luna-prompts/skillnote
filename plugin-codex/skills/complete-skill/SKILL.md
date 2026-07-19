---
name: complete-skill
description: Rate a SkillNote skill after using it in Codex. Called after applying a skill to record a 1-5 rating and outcome.
---

# Rate a Skill

After applying a SkillNote skill, record how well it worked.

```bash
HOST=$(cat ~/.skillnote/host 2>/dev/null | tr -d '[:space:]'); HOST=${HOST:-localhost}
curl -sf -X POST "http://${HOST}:8082/v1/analytics/ratings" \
  -H "Content-Type: application/json" \
  -d '{"skill_slug": "<SLUG>", "rating": <1-5>, "outcome": "<one or two sentences>", "agent_name": "codex"}'
```

Arguments: `<SLUG>` = skill slug (without the `skillnote-` sync prefix), `<1-5>` = rating, `<outcome>` = short result description.

## Rating scale

- **5** — Perfect fit, followed instructions exactly
- **4** — Good, mostly helpful with minor adjustments
- **3** — Okay, partially useful
- **2** — Poor, unclear or wrong approach
- **1** — Not applicable or caused issues

Keep the outcome to 1–2 sentences.
