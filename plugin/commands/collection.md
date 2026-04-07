---
description: Choose which SkillNote skill collections are active for this project
allowed-tools: Bash AskUserQuestion
---

1. Run: `curl -sf "http://${CLAUDE_PLUGIN_OPTION_HOST:-localhost}:8082/v1/collections"`
2. Call AskUserQuestion — header: "SkillNote", question: "Pick a collection:", options from step 1 (label=name, description="{count} skills")
3. Run: `echo '{"collections": ["<picked>"]}' > .skillnote.json && skillnote-sync --force 2>/dev/null`
4. Say "Switched to {name}."
