# SkillNote ↔ OpenClaw — User-Stated Direction

> **What this is:** A capture of the user's (Atharva's) actual direction across the planning conversation on 2026-04-26. Written for review. The earlier draft plan (`2026-04-26-skillnote-openclaw-v1.md`) and its review are parked — we start fresh from this document.
>
> **How to read:** Each section is what the user said or decided, in their own framing. Quotes are verbatim. Anything in `[brackets]` is my paraphrase. If anything below misrepresents your direction, mark it and we redo it.

---

## 1. The Ask

> *"Lets figure how we can add support of skillnote in openclaw.. It should feel like native support into openclaw how we have added the support for claude code."*

OpenClaw integration that feels as native as the existing Claude Code plugin (which lives in `/plugin/`). State-of-the-art. First of its kind. Not a generic "we support X" feature.

> *"We trying to achieve something which is unique and first of its kind. Kinda of state of the art. Need to be unique and need to break the rules. We are first like trying to democratise the skills rather just a thing."*

---

## 2. Principles (stated by you)

These are the hard constraints I should not violate when planning.

**P1 — Non-technical users.** Most users will be non-technical. Don't expect them to install dev tools, paste URLs, configure settings, or pick from menus.

**P2 — Don't reduce OpenClaw's autonomy.** OpenClaw's whole value is that it gets shit done without bothering the user.
> *"We want to power open claw agent via skillnote... and not reduce the autonomicity of it.. Why openclaw is great because it gets the shit done.. without much bothering the user unless necessary."*

**P3 — Don't ask the user obvious questions.**
- No collection picker. Agent picks based on context.
- No "what's your SkillNote address" prompt.
> *"From where the user will get this address?"* (asked rhetorically — meaning: don't ask them at all)
- Only ask the user when it's genuinely necessary or there's real ambiguity.

**P4 — Don't reinvent primitives.** Lean on what exists. Don't build parallel things just because we could.
> *"Need of necessary, we have clawhub, then skill.sh and web as well along with this.. We can give comments on the skill. maybe we can leverage that."*

**P5 — Be opinionated and break rules.** The point is to do something nobody else has done.

---

## 3. The Product Definition (your framing)

The clearest one-line definition you gave:

> *"Basically its a onestop place for agent of openclaw regarding the skills. It can self reflect add comment regarding the usefulness.. user and agent collaboratively will add skills, maintain, keep the feedback.., clone from marketplace.. and UI will help them... to visualise things in it.."*

Decomposed:

- **SkillNote is the agent's home for skills** — not a tool the agent uses, a place the agent inhabits.
- **Two collaborators in one space** — the OpenClaw agent and the human, working together on the same skill registry.
- **What the agent does in this space:**
  - Self-reflects on whether skills helped
  - Comments on skills (usefulness, drift, corrections)
  - Adds and maintains skills
  - Clones from marketplace (ClawHub) when there's a gap
- **What the human does in this space:**
  - Adds and maintains skills alongside the agent
  - Reviews/approves agent contributions
  - Uses the web UI to visualize what's happening
- **The web UI is the visualization layer** — it's how humans see what their agent is doing.

You also affirmed an earlier framing of mine that you liked:

> *"SkillNote shouldn't ship a plugin to that brain — it should ship a memory."*

But you immediately complicated it with the right question:

> *"(Memory or consciousness? Think creatively here. As openclaw have files like soul.md, memory.md and more such, as peter have tried to create a consciousness with the help of it. We should have we can add this in consciousness rather just a tool or something.)"*

Then you corrected back when I drifted too far into memory architecture:

> *"FOr this why again go to memeory.. we are skillnote server will have that data right? ... Skillnote is everything.. So its registry for the agent/human. In openclaw's case we are helping the agent to manage the skills and all."*

**Synthesis of your direction:** SkillNote is THE registry of record. The OpenClaw side is about *grafting awareness of that registry into the agent's existence* — using OpenClaw's consciousness layer (AGENTS.md, etc.) — without duplicating SkillNote's data anywhere else.

---

## 4. Architecture Decisions You Made

**A1 — Inject SkillNote into the agent's harness.**
> *"But we want to inject the skillnote is agent harness of skillnote.. that we should do.. so maybe a skill from skillnote will take care of that..."*

A skill (published to ClawHub) is responsible for grafting SkillNote awareness into OpenClaw's always-injected layer. Once grafted, the agent is harness-aware of SkillNote on every session — no plugin, no SDK pin, no separate install.

**A2 — Use ClawHub for marketplace, not SkillNote.**
> *"Need of necessary, we have clawhub, then skill.sh and web as well along with this."*

The agent uses ClawHub directly when it needs to search/install marketplace skills. SkillNote does NOT add a marketplace search endpoint.

**A3 — Use existing comments for agent reflection.**
> *"We can give comments on the skill. maybe we can leverage that.."* (in response to my proposed `skill_reflections` table)

Agent-authored reflections go through the existing `comments` table. No new "reflections" table.

**A4 — SkillNote is the source of truth for everything skill-related.**
> *"Skillnote is everything.. So its registry for the agent/human."*

Invocations, comments, ratings, history, drafts — all live in SkillNote. The agent does NOT keep parallel state in OpenClaw memory files. It calls SkillNote.

**A5 — The web UI is part of the product, not an admin afterthought.**
> *"Also think, how user will able to use our UI.. And there should be instructions as well for openclaw agent to like how to install skillnote and all use UI."*

The UI is where the human watches and collaborates. The agent should know when to send the user to the UI and when to handle in chat.

---

## 5. What You Explicitly Rejected

**R1 — A separate plugin.** You wanted the integration to be a skill, not a plugin.
> *"Maybe a skill from skillnote will take care of that..."*

**R2 — A collection picker UI.** You pointed out OpenClaw isn't an IDE — chat-first means no picker.
> *"Claude code is not autonomous AI.. So the picker and all will be required? Here mostly the user would be non-technical as well."*

**R3 — Asking the user for a server address.** You called this out specifically.
> *"From where the user will get this address?"*

**R4 — Forcing the user to pick a collection on first install.** Same autonomy point.
> *"Also user doesn't care.. maybe a little if explicitly he mentioned or there is confusions.."*

**R5 — Adding a new `skill_reflections` table.** Reuse comments instead.

**R6 — Adding marketplace search to SkillNote.** ClawHub already does it.

**R7 — A hosted "free tier" domain (`skillnote.app`).** This was my idea, not yours. You questioned where the domain came from. SkillNote is self-hosted; we don't run hosting.

**R8 — Unnecessary auth scaffolding.** You questioned why I introduced auth at all. SkillNote currently has no auth and that posture continues for v1.

---

## 6. What You Liked / Affirmed

**L1 — The "agent says I'm doing customer support today, mode-switches autonomously" example.**
> *"I liked this idea... User: 'I'm doing customer support today' / OpenClaw: (meta-skill: switch active collection to support) 'Got it. Loaded 8 support skills...'"*

**L2 — The reframe from "tool" to "memory/consciousness."**
> *"Liked this statement: SkillNote shouldn't ship a plugin to that brain — it should ship a memory."*

**L3 — The self-bootstrapping skill pattern.** When I proposed that a skill could graft itself into AGENTS.md on first load, you said *"yes"* and asked me to draft the bootstrap.

**L4 — Researching OpenClaw's consciousness architecture (SOUL.md, MEMORY.md, HEARTBEAT.md, dreaming).** You asked me to dive deep into Peter Steinberger's design philosophy, which we did.

**L5 — The "agent self-reflects + comments + drafts + clones from marketplace, human collaborates via UI" framing.** This was your synthesis and it became the product definition.

---

## 7. Open Questions (you haven't decided yet)

These are things I think we still need your call on before a fresh plan can be drafted:

**Q1 — Persona priority for v1.** Solo OpenClaw user vs. team admin deploying for their team? Both is too much for v1 (the prior reviews flagged this as "persona schizophrenia"). Which is the day-1 wedge?

**Q2 — Is "collective soul" deferred forever or just from v1?** You liked the consciousness framing. The collective-soul / COLLECTIVE.md / shared-substrate-across-team idea was explicitly state-of-the-art and unique. Is it on the v2 roadmap, or is the simpler skill-only approach the whole product?

**Q3 — Activity feed / "what your agent did" — how prominent is this?** You affirmed it as part of the product (*"Also if user asks which is my top skill and all"*), but how central is it? Is `/me/activity` a small Settings sub-page, or is it a primary nav item, or is it the home page when SkillNote+OpenClaw is connected?

**Q4 — How does the user discover SkillNote+OpenClaw exists in the first place?** Through ClawHub search? Through the SkillNote web UI promoting it? Through Claude-Code-installed users hearing about it? GTM is undefined.

**Q5 — How does the agent identify the SkillNote host?** Since you rejected asking the user, the host has to come from somewhere. The cleanest answer (when SkillNote is self-hosted, which is the project's posture): the install bash from your own SkillNote web UI bakes the host into the skill's config. But that requires the user to ALREADY be on the SkillNote web UI — which works for team admin but not for agent-first discovery. Worth deciding deliberately.

**Q6 — Consent for the AGENTS.md graft.** Reviewers flagged the autonomous file mutation as a trust risk. Do we add a one-time "Continue Y/n?" gate, or is silent the right call? You valued autonomy — silent fits — but that's a real user-trust trade-off worth your call.

**Q7 — What does "non-technical user" actually mean for OpenClaw users?** OpenClaw users today skew technical (they installed an open-source AI runtime, not a SaaS chatbot). But your principle was "mostly the user would be non-technical." Is that aspirational (we want to grow into that audience) or current (we're seeing non-technical OpenClaw users now)? Affects what we optimize for.

---

## 7b. Decisions Locked (post-PRD review, 2026-04-26)

The PRD `skillnote_openclaw_living_skill_system_prd.md` resolved Q1, Q2, Q3, Q5, Q6, Q7. Three additional architecture decisions were locked after PRD review:

**D1 — Resolver packaging: separate skill in the bundle.** The install drops two skills: `skillnote-awareness` (meta-skill teaching SkillNote presence + when to spawn resolver) and `skillnote-resolver` (focused subagent with the structured-JSON contract from PRD §15). Main agent invokes resolver via OpenClaw's standard subagent protocol by skill name. Cleaner architecturally than inlining the resolver prompt in the awareness skill.

**D2 — V1 table count: 1 new table + comments extension.** Add `skill_usage_events` (PRD §14.2) and extend `comments` with `author_type` + `comment_type` + `rating` + `linked_usage_id` (PRD §14.1). `skill_drafts` and `marketplace_candidates` are deferred to V1.1 — drafts can initially piggyback on existing `SkillContentVersion` with a status column; marketplace candidates can be a special comment type. Promote to dedicated tables only when usage signals demand.

**D3 — CLI is orphaned; v2 does not touch it.** Audit (2026-04-26) confirmed `cli/` has zero references from `install.sh`, root `package.json` (no workspaces), `.github/`, Dockerfiles, plugin, or `setup.py`. The Claude Code workflow is `./install.sh` → `curl $API_URL/setup | bash` — no CLI surface. The PRD's bash installer (PRD §11.1) is the only OpenClaw install path. Whole-CLI deprecation is a separate follow-up PR, not bundled into v2.

**Also:** PRD §21 Q1 ("require one-time confirmation before modifying OpenClaw persistent instructions?") is already decided in PRD §16.1 — drop from open questions when PRD is revised.

---

## 8. What Gets Parked

The earlier plan and its review are parked, not deleted. They contain useful primitives we may pull back in:

- `docs/superpowers/plans/2026-04-26-skillnote-openclaw-v1.md` — drafted v1 plan (16 tasks). Has the bootstrap section, the migration shapes, the API skeletons. Useful as reference. Not the source of truth anymore.
- The `/autoplan` review report at the bottom of that file — has critical engineering bug fixes (SQL bugs, query bugs) that any future plan should incorporate even if architecture changes.

We do NOT carry forward:
- The `https://skillnote.app` hosted free tier (you rejected)
- The `POST /v1/setup/openclaw-token` JWT endpoint (was scaffolding for the rejected free tier)
- The "Authentication" Design Decision (was self-contradicting and out of scope)
- The "solo install" path as separate from "team install" (you implied collapsing personas)

---

## 9. The Next Step (proposed)

After you review this document and correct anything I got wrong:

1. **You answer Q1–Q7** (or tell me which ones you don't want to decide yet).
2. **I draft a fresh plan** that starts from this document as the spec, not from my earlier first-draft.
3. **We don't run autoplan again** until the foundation is right — the earlier review surfaced strategic confusion that came from MY drift, not from genuine plan weakness, and re-running it on a clean foundation is wasteful.

---

## 10. Honest Note on Drift

Looking back at the conversation, I drifted in three places where I should have stayed closer to your direction:

1. I introduced a hosted free-tier (`skillnote.app`) you never asked for. SaaS-pattern bias.
2. I introduced auth scaffolding (`/v1/setup/openclaw-token`) you never asked for. Defensive over-engineering.
3. I went too deep on consciousness/SOUL.md/COLLECTIVE.md framing — you liked the direction but pulled me back to *"SkillNote is the registry of record, period; OpenClaw is where we graft awareness."* I should have stopped at one round of consciousness exploration instead of two.

When you review this doc, treat it as the corrected direction. The earlier conversation has the exploration arc; this doc has the conclusions.
