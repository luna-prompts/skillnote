# PRD: SkillNote × OpenClaw — Living, Self-Improving Skill System

## 1. Product Name

**SkillNote for OpenClaw: Living Skill System**

Working tagline:

> SkillNote gives OpenClaw a living, self-improving skill system — where the agent uses, reviews, fixes, and grows its own capabilities with human oversight.

---

## 2. Executive Summary

SkillNote should become the **source of truth for OpenClaw’s skills**, while OpenClaw remains the autonomous execution layer.

The integration should not feel like a bolt-on plugin, settings page, or manual sync tool. It should feel native to OpenClaw’s agent model: the agent understands that SkillNote is where its skills live, autonomously chooses the right skills for the current task, uses them, reflects on their usefulness, suggests improvements, and exposes that evolution to the human through SkillNote’s UI.

The core product idea is:

> OpenClaw should not just install skills. OpenClaw should cultivate skills.

This means SkillNote is not merely a repository of `SKILL.md` files. It becomes the **living registry** where agent and human collaboratively maintain capabilities over time.

---

## 3. Problem Statement

OpenClaw can use skills to expand what it can do. But as the number of skills grows, the current skill experience has predictable problems:

1. **Skill overload**  
   Users and agents may have too many skills available. It becomes unclear which skill should be used for which task.

2. **Manual selection does not fit OpenClaw**  
   A collection picker may work in an IDE-style coding agent, but OpenClaw is chat-first and autonomous. Asking the user to pick collections weakens the product’s core value.

3. **Skills become stale**  
   Policies, workflows, commands, APIs, and company practices change. Static skills decay unless someone reviews and updates them.

4. **No feedback loop**  
   Agents use skills, but the system usually does not learn which skills helped, failed, conflicted, or caused confusion.

5. **Non-technical users cannot manage agent capabilities manually**  
   Most future users should not be expected to inspect markdown, paste server URLs, configure skill folders, or understand collection routing.

6. **Marketplace skills are useful but risky**  
   OpenClaw can benefit from ClawHub and other skill marketplaces, but third-party skills should not be blindly trusted or installed without guardrails.

---

## 4. Product Vision

SkillNote becomes the **agent-human skill workspace** for OpenClaw.

The human sees:

- What skills the agent used
- Which skills worked well
- Which skills failed
- Which skills need updates
- Which new skills the agent recommends
- Which marketplace skills might fill a capability gap
- Which skill drafts require human approval

The agent gets:

- A trusted registry of available skills
- Collections and metadata
- Skill ratings and usage history
- Comments and past reflections
- A place to write back observations
- A way to propose improvements without silently mutating production skills

The integration should feel like OpenClaw has gained a **skill consciousness**, not like someone added another admin panel.

---

## 5. Core Principles

### P1 — SkillNote is the source of truth

All durable skill-related data lives in SkillNote:

- Skills
- Collections
- Skill versions
- Comments
- Ratings
- Usage history
- Drafts
- Agent suggestions
- Marketplace provenance

OpenClaw should not maintain a parallel skill registry.

### P2 — OpenClaw remains autonomous

The user should not need to manually choose a collection for normal tasks. OpenClaw should resolve the right skills automatically using a Skill Resolver subagent.

### P3 — The server does not decide task context alone

SkillNote should expose the skill universe. It should not be the primary brain deciding what to use.

OpenClaw has the live context: user message, current channel, task state, previous conversation, workspace, tools, and risk level. Therefore, OpenClaw should spawn a dedicated subagent to decide which skills or collections are relevant.

### P4 — Use existing primitives

Do not reinvent what already exists:

- Use ClawHub for marketplace search/install.
- Use SkillNote comments for agent reflections.
- Use existing SkillNote skill/version concepts where possible.
- Use OpenClaw’s skill model instead of inventing a separate plugin runtime.

### P5 — Human oversight, not human micromanagement

The human should approve meaningful changes, not babysit every routing decision.

Ask the user only when:

- Confidence is low
- The action is risky
- A marketplace skill is untrusted
- A skill wants dangerous permissions
- There are two equally valid interpretations
- The task involves money, credentials, deletion, external messaging, production systems, or irreversible changes

### P6 — Non-technical by default

Do not require users to:

- Paste a SkillNote server URL manually
- Pick a collection every time
- Understand `SKILL.md`
- Review raw config files
- Know the difference between SkillNote, ClawHub, and OpenClaw internals

### P7 — Opinionated and differentiated

This should not be marketed as “OpenClaw support.” It should be positioned as a living skill system for autonomous agents.

---

## 6. Target Users

### Primary V1 Persona: Solo OpenClaw Power User / Builder

This user:

- Runs OpenClaw locally
- Wants their agent to become better over time
- Uses skills frequently
- Is comfortable with initial setup
- Wants visibility into how the agent uses skills
- May already use SkillNote or Claude Code skills

Why this persona first:

- They are close enough to the current OpenClaw ecosystem.
- They can tolerate a lightweight install command.
- They will understand the value of skill self-improvement.
- They can provide high-quality feedback before expanding to less technical users.

### Secondary Persona: Team Admin / Agent Ops Owner

This user:

- Manages skills for multiple agents or team members
- Wants central visibility
- Wants reusable workflows
- Wants to review agent suggestions before team-wide rollout

This persona is important but should not dominate V1 implementation.

### Future Persona: Non-technical Operator

This user:

- Uses OpenClaw through chat channels
- Does not know or care about skill internals
- Wants the agent to “just know how we do things”

The product should be designed in a way that can evolve toward this persona, but V1 can assume the first install is done by a technical owner.

---

## 7. Goals

### G1 — Make OpenClaw SkillNote-aware

OpenClaw should know that SkillNote is its registry of record for skills and collections.

### G2 — Resolve skills autonomously

OpenClaw should spawn a Skill Resolver subagent that decides which skills or collections should be used for a task.

### G3 — Close the feedback loop

After using skills, OpenClaw should log usage, ratings, comments, and improvement suggestions back into SkillNote.

### G4 — Make skill evolution visible to humans

SkillNote UI should show users what the agent is doing with skills:

- Used skills
- Useful skills
- Failing skills
- Stale skills
- Drafted improvements
- Suggested marketplace clones

### G5 — Enable safe skill improvement

The agent should be able to draft improvements, not silently modify production skills unless explicitly allowed.

### G6 — Preserve OpenClaw autonomy

SkillNote should enhance OpenClaw’s autonomy, not turn it into a manually configured workflow tool.

---

## 8. Non-Goals for V1

The following are explicitly out of scope for V1:

1. **Hosted SkillNote cloud / free tier**  
   SkillNote remains self-hosted for this scope.

2. **Full authentication system**  
   Do not introduce JWT, teams, OAuth, or hosted account concepts unless already present elsewhere in the product.

3. **SkillNote marketplace search endpoint**  
   Use ClawHub or existing marketplace infrastructure. SkillNote should not duplicate marketplace search.

4. **Manual collection picker as primary UX**  
   The agent should resolve skills automatically.

5. **Separate OpenClaw plugin runtime**  
   V1 should use an OpenClaw skill-based integration path.

6. **Silent installation of untrusted marketplace skills**  
   Marketplace discovery can be autonomous, but installation/use of risky skills needs a safety gate.

7. **Generic memory system**  
   SkillNote is not OpenClaw’s personal memory. It is the skill/capability registry.

8. **Collective-soul/team consciousness architecture**  
   This can be explored later, but V1 should focus on skill awareness, usage, reflection, and review.

---

## 9. Product Architecture

### 9.1 High-Level Flow

```text
User message
   ↓
Main OpenClaw agent
   ↓ spawns
Skill Resolver Subagent
   ↓
SkillNote API: available collections, skills, metadata, ratings, comments, usage
   ↓
Skill Resolver chooses relevant collection/skills
   ↓
Main OpenClaw agent executes task using selected skills
   ↓
OpenClaw logs usage/reflection back to SkillNote
   ↓
SkillNote UI shows activity, comments, suggestions, and drafts
```

### 9.2 Responsibility Split

| Component | Responsibility |
|---|---|
| SkillNote | Registry of record for skills, collections, versions, ratings, comments, drafts, usage, provenance |
| OpenClaw Main Agent | Execute user task using selected skills |
| Skill Resolver Subagent | Decide which skills/collections are relevant for the current task |
| ClawHub | Marketplace discovery/install source |
| SkillNote UI | Human review, visualization, approval, and maintenance |

### 9.3 Why Subagent Instead of Server-Side Resolver

SkillNote should not decide the best skills alone because it lacks the complete runtime context.

The Skill Resolver subagent has access to:

- Current user message
- Channel context
- Workspace/task state
- Recent conversation
- Risk level
- Available tools
- OpenClaw’s current execution plan

SkillNote has access to:

- Skills
- Collections
- Skill metadata
- Ratings
- Comments
- Usage history
- Drafts
- Provenance

Therefore, the best architecture is:

> SkillNote provides the skill universe. OpenClaw’s Skill Resolver subagent chooses what to use.

---

## 10. Key Concepts

### 10.1 SkillNote Awareness Skill

A special OpenClaw skill named something like:

```text
skillnote-awareness
```

Purpose:

- Teach OpenClaw that SkillNote exists
- Explain when to query SkillNote
- Explain how to spawn the Skill Resolver subagent
- Explain how to log usage/reflections
- Explain when to ask human approval
- Explain how to route the user to SkillNote UI

This is not a normal task skill. It is a meta-skill.

### 10.2 Skill Resolver Subagent

A specialized subagent spawned by OpenClaw when skill selection is needed.

Responsibilities:

1. Understand the task.
2. Query SkillNote for relevant skill inventory.
3. Review metadata, ratings, comments, and usage signals.
4. Select the best collection and skills.
5. Return a compact routing decision.
6. Flag low-confidence or risky cases.

Example output:

```json
{
  "collection": "customer-support",
  "skills": ["refund-policy", "support-tone", "crm-update"],
  "confidence": 0.86,
  "reason": "User is drafting a customer refund reply. Support tone and refund rules are relevant.",
  "needs_user_confirmation": false,
  "risk_level": "low"
}
```

### 10.3 Agent Reflection via Comments

Reuse SkillNote’s existing comments primitive.

Comment types may include:

```text
human_comment
agent_observation
agent_issue
agent_patch_suggestion
agent_success_note
agent_deprecation_warning
```

Example:

```text
Skill: refund-policy
Author: OpenClaw agent
Type: agent_issue
Rating: 3/5
Comment: This skill helped with tone, but the policy section appears stale. User referenced a 14-day refund window while the skill says 7 days.
Suggested action: Update refund window and add escalation rule.
```

### 10.4 Skill Drafts

The agent should not directly overwrite production skills by default.

When it detects a needed change, it creates a draft:

```text
Original skill: refund-policy
Draft title: Update refund policy window from 7 days to 14 days
Reason: Repeated user correction and recent support workflow mismatch
Status: Needs human review
```

### 10.5 Skill Garden

A product metaphor for the ongoing maintenance of skills.

Skill Garden includes:

- Stale skills
- Duplicate skills
- Unused skills
- Highly rated skills
- Low-rated skills
- Skills needing review
- Skills suggested by the agent
- Marketplace skills worth cloning

This can become a major UX differentiator.

---

## 11. User Experience

### 11.1 Installation Flow

V1 should avoid asking the user for a SkillNote server address inside OpenClaw.

Preferred flow:

1. User opens SkillNote UI.
2. User goes to **Integrations → OpenClaw**.
3. SkillNote generates a one-line install command with the host embedded.
4. User runs it once.
5. The command installs the `skillnote-awareness` skill and local config.
6. OpenClaw can now discover SkillNote automatically.

Example generated command:

```bash
curl -sf http://localhost:8082/setup/openclaw | bash
```

Generated files may include:

```text
.openclaw/skills/skillnote-awareness/SKILL.md
.openclaw/skillnote/config.json
```

Example config:

```json
{
  "skillnote_base_url": "http://localhost:8082",
  "mode": "local",
  "auto_resolve_skills": true,
  "write_reflections": true,
  "allow_draft_creation": true,
  "allow_auto_marketplace_install": false
}
```

### 11.2 First-Run Experience

When OpenClaw first detects SkillNote:

```text
SkillNote connected. I can now use your SkillNote registry to choose relevant skills, log what helped, and suggest improvements when skills become stale.
```

Avoid overwhelming the user with configuration choices.

### 11.3 Normal Task Experience

User:

```text
I'm doing customer support today. Help me reply to this refund complaint.
```

OpenClaw internally spawns Skill Resolver.

OpenClaw response:

```text
Got it. I’ll use your support skills for refund policy, tone, and escalation handling.
```

No collection picker.

### 11.4 Low-Confidence Experience

If the Skill Resolver is unsure:

```text
I found two possible skill sets: customer support and sales escalation. This looks closer to customer support because the user is asking for a refund. I’ll proceed with that unless you want sales escalation instead.
```

Default to action, but expose uncertainty.

### 11.5 Risky Skill Experience

If a skill is untrusted or risky:

```text
I found a marketplace skill that could help, but it has not been reviewed in your SkillNote registry. I can draft a recommendation, but I should not install or run it without your approval.
```

### 11.6 SkillNote UI Experience

Add an OpenClaw section to SkillNote.

Potential navigation:

```text
SkillNote
├── Skills
├── Collections
├── Marketplace Imports
├── OpenClaw
│   ├── Activity
│   ├── Agent Suggestions
│   ├── Skill Garden
│   └── Setup
└── Settings
```

#### OpenClaw Activity

Shows:

- Recent tasks
- Skills used
- Collection selected
- Confidence
- Outcome
- Agent comments
- Ratings

#### Agent Suggestions

Shows:

- Skill update drafts
- New skill proposals
- Marketplace clone candidates
- Skills marked stale
- Duplicate skill candidates

#### Skill Garden

Shows health metrics:

- Top skills
- Low-rated skills
- Unused skills
- Recently improved skills
- Stale skills
- Skills with unresolved comments

#### Setup

Shows:

- OpenClaw connection status
- Install command
- Last sync time
- Local config state
- Troubleshooting instructions

---

## 12. Functional Requirements

### FR1 — OpenClaw Integration Setup

SkillNote must provide a setup page that generates an OpenClaw install command.

Acceptance criteria:

- User can copy a single command.
- Command includes SkillNote base URL automatically.
- Command installs `skillnote-awareness` skill.
- Command writes local SkillNote config.
- Command does not require user to manually paste server address into OpenClaw.

### FR2 — SkillNote Awareness Skill

The installed skill must tell OpenClaw how to use SkillNote.

Acceptance criteria:

- Skill explains when to query SkillNote.
- Skill explains how to spawn Skill Resolver subagent.
- Skill explains how to log usage and comments.
- Skill explains when human confirmation is required.
- Skill does not duplicate full skill registry content locally.

### FR3 — Skill Inventory API

SkillNote must expose APIs for OpenClaw to fetch relevant skill inventory.

Acceptance criteria:

- API returns skills.
- API returns collections.
- API returns ratings.
- API returns usage summaries.
- API returns recent comments.
- API supports lightweight filtering.

### FR4 — Skill Resolver Subagent Contract

OpenClaw must use a subagent-style decision contract to choose skills.

Acceptance criteria:

- Resolver returns selected collection.
- Resolver returns selected skills.
- Resolver returns confidence score.
- Resolver returns reason.
- Resolver returns risk level.
- Resolver returns whether user confirmation is needed.

### FR5 — Usage Logging

OpenClaw must log skill usage back to SkillNote.

Acceptance criteria:

- Logs selected skill IDs.
- Logs selected collection ID.
- Logs task summary.
- Logs resolver confidence.
- Logs outcome if available.
- Does not store sensitive raw user messages by default unless explicitly configured.

### FR6 — Agent Comments

OpenClaw must be able to add comments to skills.

Acceptance criteria:

- Agent can write a comment.
- Comment identifies author as agent.
- Comment has a type.
- Comment can optionally include rating.
- Comment can link to a usage event.

### FR7 — Draft Skill Improvements

OpenClaw must be able to propose skill changes as drafts.

Acceptance criteria:

- Agent can create draft from existing skill.
- Draft includes reason.
- Draft is not auto-published.
- Human can approve, reject, or edit draft.

### FR8 — SkillNote UI Activity Feed

SkillNote must show OpenClaw activity.

Acceptance criteria:

- User can see recent skill usage.
- User can see selected collection.
- User can see resolver confidence.
- User can see comments/reflections.
- User can filter by skill, collection, or status.

### FR9 — Skill Garden UI

SkillNote must show skill health.

Acceptance criteria:

- User can see low-rated skills.
- User can see stale skills.
- User can see unused skills.
- User can see agent-suggested improvements.
- User can see top skills.

### FR10 — Marketplace Candidate Handling

OpenClaw may suggest ClawHub marketplace skills, but SkillNote should not duplicate marketplace search.

Acceptance criteria:

- Agent can record marketplace candidate in SkillNote.
- Candidate includes source, reason, and risk state.
- Candidate requires human review before install/use if untrusted.
- SkillNote does not become a marketplace search engine.

---

## 13. API Requirements

Exact route names can change based on the existing backend structure. The PRD defines capability-level requirements.

### 13.1 Get OpenClaw Context Bundle

Purpose: Provide the Skill Resolver subagent with skill inventory and relevant metadata.

```http
POST /api/openclaw/context-bundle
```

Request:

```json
{
  "task_summary": "User wants help replying to a refund complaint.",
  "channel": "telegram",
  "workspace": "default",
  "recent_skill_ids": ["support-tone"],
  "max_skills": 20
}
```

Response:

```json
{
  "collections": [
    {
      "id": "support-ops",
      "name": "Support Ops",
      "description": "Customer support workflows, tone, refund, escalation."
    }
  ],
  "skills": [
    {
      "id": "refund-policy",
      "name": "Refund Policy",
      "collection_id": "support-ops",
      "description": "Refund rules and escalation instructions.",
      "rating_avg": 4.2,
      "usage_count_30d": 18,
      "staleness_status": "needs_review",
      "recent_comments_summary": "Agent noted refund window may be outdated."
    }
  ]
}
```

### 13.2 Log Skill Usage

```http
POST /api/openclaw/usage
```

Request:

```json
{
  "task_summary": "Drafted refund complaint response.",
  "collection_id": "support-ops",
  "skill_ids": ["refund-policy", "support-tone"],
  "resolver_confidence": 0.86,
  "risk_level": "low",
  "outcome": "completed",
  "metadata": {
    "channel": "telegram"
  }
}
```

### 13.3 Create Agent Comment

```http
POST /api/skills/{skill_id}/comments
```

Request:

```json
{
  "author_type": "agent",
  "author_name": "openclaw-main",
  "comment_type": "agent_issue",
  "rating": 3,
  "body": "Skill helped with tone, but refund policy appears stale.",
  "linked_usage_id": "usage_123"
}
```

### 13.4 Create Skill Draft

```http
POST /api/skills/{skill_id}/drafts
```

Request:

```json
{
  "created_by": "agent",
  "reason": "Refund policy appears stale based on repeated user correction.",
  "proposed_content": "...updated SKILL.md content...",
  "source_usage_id": "usage_123"
}
```

### 13.5 Record Marketplace Candidate

```http
POST /api/openclaw/marketplace-candidates
```

Request:

```json
{
  "source": "clawhub",
  "skill_name": "gmail-support-triage",
  "source_url": "...",
  "reason": "User repeatedly asks for support email triage, but no local skill exists.",
  "risk_status": "unreviewed",
  "recommended_action": "review_before_install"
}
```

---

## 14. Data Model Additions

Prefer extending existing tables where possible.

### 14.1 Comments Table Extension

If comments already exist, extend minimally:

```text
comments
- id
- skill_id
- author_type: human | agent
- author_name
- comment_type: human_comment | agent_observation | agent_issue | agent_patch_suggestion | agent_success_note | agent_deprecation_warning
- rating nullable
- body
- linked_usage_id nullable
- created_at
```

### 14.2 Usage Events

```text
skill_usage_events
- id
- agent_name
- task_summary
- collection_id nullable
- skill_ids json
- resolver_confidence
- risk_level
- outcome
- channel nullable
- metadata json nullable
- created_at
```

### 14.3 Drafts

```text
skill_drafts
- id
- skill_id nullable
- title
- proposed_content
- reason
- created_by: human | agent
- status: draft | needs_review | approved | rejected | published
- source_usage_id nullable
- created_at
- updated_at
```

### 14.4 Marketplace Candidates

```text
marketplace_candidates
- id
- source
- skill_name
- source_url
- reason
- risk_status: unreviewed | trusted | rejected | installed
- recommended_action
- created_by: agent | human
- created_at
```

---

## 15. Skill Resolver Subagent Prompt Contract

The Skill Resolver should be a focused subagent with strict output.

### Input

```json
{
  "user_message": "I'm doing customer support today. Help me reply to this refund complaint.",
  "channel": "telegram",
  "workspace": "default",
  "task_context": "User is preparing a reply to a customer asking for refund.",
  "available_collections": [...],
  "available_skills": [...],
  "recent_comments": [...],
  "usage_summary": [...]
}
```

### Output

```json
{
  "selected_collection_id": "support-ops",
  "selected_skill_ids": ["refund-policy", "support-tone", "crm-update"],
  "confidence": 0.86,
  "risk_level": "low",
  "needs_user_confirmation": false,
  "reason": "The task is a customer refund reply and requires policy, tone, and CRM update guidance.",
  "missing_capability": null,
  "suggest_marketplace_search": false
}
```

### Rules

The resolver must:

- Prefer high-rated relevant skills.
- Penalize stale or low-rated skills unless no alternative exists.
- Consider recent agent comments.
- Avoid loading too many skills.
- Prefer the smallest useful skill set.
- Ask for confirmation only when needed.
- Never install marketplace skills itself.
- Return structured JSON only.

---

## 16. Safety and Trust Requirements

### 16.1 No Silent Dangerous Mutation

The integration should not silently mutate high-impact files or production skills.

Recommended rule:

- Installing `skillnote-awareness` can be a one-time explicit setup.
- Updating OpenClaw persistent instructions should require at least one explicit confirmation.
- Skill content changes should be drafts by default.

### 16.2 Marketplace Risk Gate

Marketplace skills are treated as untrusted until reviewed.

OpenClaw can:

- Search ClawHub
- Suggest a candidate
- Record candidate in SkillNote
- Explain why it may help

OpenClaw should not automatically:

- Install unreviewed skills
- Execute unreviewed skill commands
- Grant sensitive access to new skills

### 16.3 Sensitive Data Handling

Skill usage logs should not store full raw user messages by default.

Store:

- Task summary
- Skill IDs
- Collection ID
- Confidence
- Outcome
- Risk level

Avoid storing:

- Credentials
- Personal messages
- Full email bodies
- Raw customer data
- API keys
- Private files

### 16.4 Human Approval Gates

Require approval for:

- Installing unreviewed marketplace skill
- Publishing agent-created draft
- Editing persistent OpenClaw instructions
- Running skills with dangerous permissions
- External irreversible actions
- Production operations

---

## 17. Success Metrics

### Activation Metrics

- Number of OpenClaw integrations completed
- Number of SkillNote awareness skill installs
- Percentage of connected OpenClaw agents that log first usage event

### Usage Metrics

- Skill usage events per active OpenClaw user
- Average skills selected per task
- Collection auto-resolution rate
- Low-confidence resolver rate
- User confirmation rate

### Quality Metrics

- Average skill rating from agent comments
- Percentage of tasks completed with selected skills
- Number of stale skills detected
- Number of skill drafts created
- Draft approval rate
- Reduction in repeated user corrections

### Retention Metrics

- Weekly active SkillNote + OpenClaw users
- Repeat usage of Skill Garden
- Number of human-reviewed agent suggestions

### Differentiation Metrics

- Number of skills improved through agent feedback
- Number of marketplace candidates reviewed
- Number of agent-created comments
- Number of skills with closed feedback loop

---

## 18. V1 Scope

### Must Have

1. SkillNote OpenClaw setup page
2. Generated install command
3. `skillnote-awareness` skill
4. Local config with SkillNote host
5. Skill inventory/context API
6. Skill Resolver subagent contract
7. Usage logging API
8. Agent comments using existing comments system
9. Draft skill improvement flow
10. Basic OpenClaw Activity UI
11. Basic Agent Suggestions UI
12. Marketplace candidate recording, not marketplace search duplication
13. Safety gates for untrusted marketplace skills

### Should Have

1. Skill Garden dashboard
2. Stale skill detection
3. Low-rated skill list
4. Duplicate skill candidate detection
5. One-click approve/reject draft
6. Filters by collection, skill, agent, and status

### Could Have

1. Skill health score
2. Timeline view per skill
3. Suggested skill merge/split
4. Exportable report of agent skill usage
5. Workspace-level OpenClaw configuration

### Won’t Have in V1

1. Hosted SkillNote cloud
2. Full auth/team RBAC
3. Silent marketplace installs
4. Full OpenClaw upstream onboarding integration
5. Dedicated marketplace search inside SkillNote
6. Collective-soul/team consciousness model

---

## 19. Milestones

### Milestone 1 — Foundation

- Add OpenClaw setup page
- Generate install command
- Create `skillnote-awareness` skill template
- Write local config file
- Verify OpenClaw can detect SkillNote config

### Milestone 2 — Resolver Contract

- Build SkillNote context-bundle API
- Define Skill Resolver subagent prompt contract
- Return selected collection/skills/confidence/risk
- Add fallback behavior for low confidence

### Milestone 3 — Feedback Loop

- Add usage logging
- Add agent comments
- Link comments to usage
- Show basic OpenClaw Activity UI

### Milestone 4 — Human Review Layer

- Add draft skill improvement flow
- Add Agent Suggestions page
- Approve/reject/edit draft
- Record marketplace candidates

### Milestone 5 — Skill Garden

- Add stale skill detection
- Add low-rated skills
- Add unused skills
- Add top skills
- Add basic health dashboard

---

## 20. Example End-to-End Scenarios

### Scenario 1 — Support Mode

User:

```text
I'm doing customer support today. Help me reply to this refund complaint.
```

Flow:

1. Main agent spawns Skill Resolver.
2. Resolver queries SkillNote.
3. Resolver selects `support-ops` collection.
4. Resolver selects `refund-policy`, `support-tone`, `crm-update`.
5. Main agent drafts reply.
6. Agent logs usage.
7. Agent comments that `refund-policy` may be stale.
8. SkillNote UI shows suggestion.

### Scenario 2 — Missing Capability

User:

```text
Can you triage my incoming Gmail support tickets every morning?
```

Flow:

1. Resolver finds no local Gmail support triage skill.
2. Resolver returns missing capability.
3. Main agent searches ClawHub.
4. Main agent records marketplace candidate in SkillNote.
5. User reviews candidate in UI before install.

### Scenario 3 — Skill Improvement

Agent repeatedly notices that the refund window is wrong.

Flow:

1. Agent adds comment to `refund-policy`.
2. Agent creates draft update.
3. SkillNote shows draft in Agent Suggestions.
4. Human approves after editing.
5. Updated skill becomes new version.

### Scenario 4 — Low Confidence

User:

```text
Help me respond to this angry customer about billing and enterprise contract terms.
```

Resolver finds both support and sales/legal collections relevant.

OpenClaw says:

```text
This touches both support and enterprise contract handling. I’ll use support tone plus enterprise escalation rules and avoid making legal commitments.
```

If confidence is too low, ask:

```text
Should I treat this as a support response or an enterprise account escalation?
```

---

## 21. Open Questions

1. Should V1 require one-time confirmation before modifying OpenClaw persistent instruction files?
2. Should SkillNote store only task summaries or optionally raw task snippets?
3. Should the first UI landing page be Activity, Agent Suggestions, or Skill Garden?
4. Should agent-created comments require human review before becoming visible in normal skill pages?
5. Should SkillNote support multiple OpenClaw agents in V1 or assume one local agent?
6. How much marketplace candidate metadata should be stored?
7. Should resolver decisions be fully logged for debugging?
8. Should stale skill detection be rule-based first or LLM-assisted from the start?

---

## 22. Recommended V1 Product Positioning

Do not position this as:

```text
SkillNote now supports OpenClaw.
```

That is weak.

Position it as:

```text
SkillNote gives OpenClaw a living skill system.
```

Better launch copy:

> OpenClaw can now use SkillNote as its living skill registry. It can choose the right skills for each task, learn which ones helped, flag stale instructions, draft improvements, and let you review its evolution from the SkillNote UI.

Even sharper:

> Your OpenClaw agent no longer just uses skills. It cultivates them.

---

## 23. Final Recommendation

Build the product around the Skill Resolver subagent, not server-side skill routing.

The architecture should be:

```text
SkillNote = source of truth
OpenClaw Skill Resolver = runtime decision-maker
OpenClaw Main Agent = executor
SkillNote UI = human review and visualization layer
ClawHub = marketplace source
```

This keeps the product clean, agent-native, and differentiated.

The winning idea is not “sync skills into OpenClaw.”

The winning idea is:

> SkillNote becomes the place where OpenClaw’s capabilities live, improve, and become visible.

