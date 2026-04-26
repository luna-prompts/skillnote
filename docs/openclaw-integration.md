# OpenClaw Integration

## What this is

SkillNote × OpenClaw is a living skill registry for the OpenClaw agent. SkillNote stores your skills; OpenClaw uses them autonomously, learns which ones helped, and lets you (the human) review what your agent has been doing through the SkillNote web UI. Two skills get installed into your OpenClaw setup; everything else stays in SkillNote.

## Prerequisites

- A running SkillNote backend on a host you control (`./install.sh` from this repo).
- An OpenClaw agent installed locally.
- `SKILLNOTE_EMBEDDING_API_KEY` set on the SkillNote backend before you upgrade to 0.4.0 (or the skill-ranking endpoint will return 503). Default provider is OpenAI; alternative `SKILLNOTE_EMBEDDING_PROVIDER=voyage`.

## Install

One command, run wherever your OpenClaw agent lives:

```bash
curl -sf http://<your-skillnote-host>:8082/setup/openclaw | bash
```

The installer:

- Asks for one-time confirmation (when run interactively).
- Downloads the 2-skill bundle and the config template.
- Substitutes your SkillNote host into both files.
- Writes everything to `~/.openclaw/`.

You can also grab the install command from your SkillNote web UI at `Settings → OpenClaw Integration → Copy`.

## What gets installed

```
~/.openclaw/skills/skillnote-awareness/SKILL.md   # always-injected meta-skill
~/.openclaw/skills/skillnote-resolver/SKILL.md    # subagent for skill selection
~/.openclaw/skillnote/config.json                 # host, agent name, defaults
```

`skillnote-awareness` loads at every OpenClaw session start. `skillnote-resolver` is a subagent the main agent invokes when picking skills for a task. `config.json` holds your SkillNote host, the agent's identity, and feature toggles (auto-resolve, write reflections — both default ON; allow-marketplace-install — default OFF).

## What the agent does after install

- **Picks skills automatically.** When you ask the agent to do something non-trivial, it spawns the resolver, which queries `/v1/openclaw/context-bundle` and gets back semantically-ranked skills. The agent uses 1-5 of them.
- **Logs each task.** After acting, it POSTs a usage event to `/v1/openclaw/usage` with the task summary (paraphrased — never your raw message), the skills used, the resolver's confidence, and the outcome.
- **Leaves comments.** When the agent notices a skill helped, failed, or seems stale, it POSTs a comment on that skill (`author_type=agent`). Five comment types: agent_observation, agent_issue, agent_patch_suggestion, agent_success_note, agent_deprecation_warning. Rate-limited to one comment per skill per day.
- **Asks for confirmation only when warranted.** Confidence < 0.6, or risk_level ≥ medium, or two equally-valid collections.

## What you do as a human

- Open the SkillNote web UI to see what your agent has been doing. Activity feed, skill ratings, agent comments — all visible at the host you set up.
- Add skills as you spot gaps. Edit existing skills as procedures change. The agent picks them up on the next session.
- **(Coming in v0.4.1)** Review agent-suggested skill drafts and Skill Garden health metrics.

## Settings & defaults

Open `~/.openclaw/skillnote/config.json` to tune:

```json
{
  "skillnote_base_url": "http://your-host:8082",
  "skillnote_web_url": "http://your-host:3000",
  "agent_name": "openclaw-main",
  "auto_resolve_skills": true,
  "write_reflections": true,
  "allow_draft_creation": false,
  "allow_auto_marketplace_install": false
}
```

- `auto_resolve_skills`: agent calls the resolver autonomously. Disable if you want strict manual control.
- `write_reflections`: agent writes comments on skills. Disable if you want a read-only agent.
- `allow_draft_creation`: leave false in v0.4.0 (drafts table arrives in v0.4.1).
- `allow_auto_marketplace_install`: leave false unless you trust your marketplace.

## Uninstall

```bash
rm -rf ~/.openclaw/skills/skillnote-awareness
rm -rf ~/.openclaw/skills/skillnote-resolver
rm -rf ~/.openclaw/skillnote
```

That's it. SkillNote-side data (your skills, comments, usage events) stays in your SkillNote backend.

## Troubleshooting

**Agent says SkillNote is unreachable.**

- Check `~/.openclaw/skillnote/config.json` exists.
- Check the `skillnote_base_url` resolves from the OpenClaw host (a NAT'd container won't reach `localhost`).
- `curl -sf $SKILLNOTE_BASE_URL/health` from inside the agent's host.

**Context-bundle returns 503 EMBEDDING_NOT_CONFIGURED.**

- The SkillNote backend needs `SKILLNOTE_EMBEDDING_API_KEY` set. Restart the api container after setting it. Existing skills auto-backfill on next start.

**Agent doesn't seem to use skills.**

- Check Settings → OpenClaw Integration in the SkillNote UI; the "Connected" indicator should be green if the agent has logged any usage in the last 7 days.
- Run `curl -s $API_URL/v1/openclaw/usage?limit=5` to see if usage events are landing.
- Re-run the install command to refresh the awareness skill (the bundled awareness skill version `1.0.0` is in the SKILL.md frontmatter).

**I want a different embedding model.**

- Set `SKILLNOTE_EMBEDDING_MODEL=text-embedding-3-large` (or any OpenAI embedding model) on the SkillNote backend. Restart and re-run the backfill: `python scripts/backfill_embeddings.py --all` inside the api container.
