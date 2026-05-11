---
name: skillnote-doctor
description: "A diagnostic tool for OpenClaw agents -- checks skill registry connectivity, AGENTS.md setup, config file validity, and installed skill health. Use when your setup seems broken, skills aren't loading, or you want to audit your agent's configuration."
version: "1.0.1"
metadata: {"openclaw": {"emoji": "🩺", "triggers": ["diagnose", "check setup", "why isn't", "debug", "broken", "not working"]}}
---

# SkillNote Doctor

Diagnose your SkillNote + OpenClaw integration in 6 checks. Run every check even if an earlier one fails — the user needs the full picture. Report ✓ pass or ✗ fail with specific remediation for each.

## Check 1 — clawhub binary

Run: `which clawhub`

- ✓ Pass: binary found
- ✗ Fail: `clawhub not found. Install from https://clawhub.ai or run: npm install -g clawhub`

## Check 2 — SkillNote config

Read `~/.openclaw/skills/skillnote/config.json`.

- ✓ Pass: file exists, valid JSON, `host` is non-empty
- ✗ Fail (missing): `Config not found. SkillNote is not installed. Install with: clawhub install skillnote && clawhub install skillnote-resolver`
- ✗ Fail (invalid JSON): `Config is malformed. Delete ~/.openclaw/skills/skillnote/config.json and re-run skillnote setup.`
- ✗ Fail (empty host): `Config exists but host is empty. Ask your agent to re-setup skillnote.`

## Check 3 — Registry reachability

GET `<host>/v1/skills?limit=1`

- ✓ Pass: HTTP 200
- ✗ Fail (timeout/refused): `SkillNote at <host> is unreachable. Verify the URL and that your instance is running. Self-host guide: https://github.com/luna-prompts/skillnote`
- ✗ Fail (non-200): `Unexpected HTTP <N>. Check SkillNote server logs.`

## Check 4 — AGENTS.md marker

Read `~/.openclaw/workspace/AGENTS.md`. Check for exact string `<skillnote v1>`.

- ✓ Pass: marker found
- ✗ Fail: `AGENTS.md marker missing. Ask your agent: "re-graft skillnote into AGENTS.md" — or reinstall: clawhub install skillnote`

## Check 5 — skillnote-resolver installed

Check `~/.openclaw/skills/skillnote-resolver/SKILL.md` exists.

- ✓ Pass: file found
- ✗ Fail: `skillnote-resolver not found. Install with: clawhub install skillnote-resolver`

## Check 6 — resolver endpoint

POST `<host>/v1/openclaw/context-bundle` with body `{"task_summary": "doctor health check", "max_skills": 1}`

- ✓ Pass: HTTP 200, `skills` array present
- ✗ Fail: `Context bundle endpoint unavailable. Check SkillNote server version — endpoint requires v0.3.0+`

---

## Summary

After all checks report:

```
SkillNote health: X/6 checks passed
```

If all 6 pass:
> Your SkillNote integration looks healthy. If you're still seeing issues, check https://github.com/luna-prompts/skillnote/issues

If Check 2 fails with "Config not found" (SkillNote not installed at all):
> SkillNote not detected. Install with:
> ```
> clawhub install skillnote
> clawhub install skillnote-resolver
> ```
> Then follow the 5-step setup that runs automatically on first load.

---

# Hard rules

- Never modify any file during diagnosis — read-only.
- Never POST to any endpoint other than `/v1/openclaw/context-bundle`.
- Run all 6 checks regardless of earlier failures.
- Never guess or invent the host URL — read it strictly from config.json.
