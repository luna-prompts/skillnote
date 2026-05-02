<p align="center">
  <img src="public/logo.svg" width="80" height="80" alt="SkillNote" />
</p>

<h1 align="center">S K I L L N O T E</h1>

<p align="center">
  <strong>Self-hosted skill registry for AI coding agents.</strong>
  <br />
  Create, version, and share <code>SKILL.md</code> files across your team. Stop copy-pasting skills between repos.
</p>

<p align="center">
  <a href="https://github.com/luna-prompts/skillnote/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  <a href="https://github.com/luna-prompts/skillnote"><img src="https://img.shields.io/github/stars/luna-prompts/skillnote?style=social" alt="Stars" /></a>
  <a href="https://github.com/luna-prompts/skillnote/issues"><img src="https://img.shields.io/github/issues/luna-prompts/skillnote" alt="Issues" /></a>
  <a href="https://discord.gg/GazU4amU6H"><img src="https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
  <img src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker Ready" />
  <img src="https://img.shields.io/badge/self--hosted-yes-green" alt="Self-hosted" />
</p>

<br />

<p align="center">
  <img src="docs/terminal/picker4.png" width="680" alt="SkillNote collection picker in Claude Code terminal" />
</p>

<p align="center">
  <a href="#the-problem">The Problem</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#why-collections">Collections</a> &middot;
  <a href="#marketplace">Marketplace</a> &middot;
  <a href="#agent-reviews">Reviews</a> &middot;
  <a href="#live-sync">Live Sync</a> &middot;
  <a href="#openclaw-integration">OpenClaw</a> &middot;
  <a href="#the-web-ui">Web UI</a> &middot;
  <a href="#built-on-claude-codes-native-apis">How It Works</a>
</p>

---

## The Problem

Claude Code skills are powerful but managing them breaks down fast.

**Skills stop triggering.** Claude Code shares [~8,000 characters](https://docs.anthropic.com/en/docs/claude-code/skills) across all active skill descriptions. Past that limit, descriptions get silently truncated. Skills with good documentation get cut first. The system prompt tells Claude to never use skills that aren't listed, so truncated skills are both invisible and explicitly forbidden. ([#13343](https://github.com/anthropics/claude-code/issues/13343), [#40121](https://github.com/anthropics/claude-code/issues/40121))

**Skills are scattered everywhere.** They live in `~/.claude/skills/` with no versioning, no search, and no way to share. Someone clones your project and has no idea which skills it depends on. There's no `package.json` for skills. ([#27113](https://github.com/anthropics/claude-code/issues/27113))

**Skills can't be shared across a team.** Updating a shared skill means downloading, editing, re-zipping, and hoping the upload works for everyone. New teammates discover missing skills only when something breaks. Tribal knowledge walks out the door when someone leaves.

**Private skills have nowhere to go.** Internal deploy procedures, proprietary API patterns, compliance workflows, infra runbooks. These encode institutional knowledge that can't live in a public repo or third-party registry. They need to stay on your infrastructure.

**SkillNote** is a self-hosted registry that solves all of this. A private registry for skills that can't leave your network. Collections to load only the skills you need for each session. A plugin that syncs the selected collection to Claude Code at launch and keeps it updated throughout the session. And a feedback loop where agents rate skills after use.

Your skills. Your servers. Your rules.

---

## Quick Start

Spin up the registry locally:

```bash
git clone https://github.com/luna-prompts/skillnote.git
cd skillnote
./install.sh
```

The install script builds and starts all containers, waits for health checks, and prints the connect command when ready.

Then wire up your AI agent:

<details>
<summary><b>Connect Claude Code</b></summary>

#### Recommended — one-liner

```bash
curl -sf http://localhost:8082/setup/agent | bash -s -- --agent claude-code
source ~/.zshrc
```

Same `setup/agent` endpoint works for any harness — pass `--agent claude-code` or `--agent openclaw`. Run `claude` in any project; SkillNote picks up your skills automatically and the collection picker appears on first launch.

#### Or — paste this prompt to Claude Code

If you prefer to let Claude Code install itself (works from a fresh install):

```text
I want you to install SkillNote on my machine and wire it into this Claude Code session.
SkillNote is a skill registry I'm running at http://localhost:8082.

Do the full install yourself — don't ask me to run commands.

1. Check if SkillNote is already installed:
   - Look for ~/.claude/plugins/skillnote/
   - If it exists, skip to step 3.

2. If not installed, run the official installer:
   - curl -sf http://localhost:8082/setup | bash

3. Reload the shell so the plugin is picked up:
   - source ~/.zshrc (or ~/.bashrc)

4. Confirm it works:
   - Run: claude --version
   - List the installed plugin: ls ~/.claude/plugins/skillnote/
   - Tell me what collection picker options you see when running `claude`.

Don't ask for confirmation between steps. Just run the commands and report results.
```

#### What gets installed

| Path | Role |
| ---- | ---- |
| `~/.claude/plugins/skillnote/` | The plugin code: hooks, slash commands, status line, collection picker |
| `.skillnote.json` (per project) | Pinned active collection — survives across sessions |

</details>

<details>
<summary><b>Connect OpenClaw</b></summary>

OpenClaw is a chat-first runtime. Four install methods, in order of recommendation:

#### Method 1 — Copy prompt (recommended, zero terminal)

The dominant install UX in the OpenClaw ecosystem. Skip all CLI work — paste a one-prompt setup into your agent and it installs everything itself. The Connect page in your SkillNote web UI generates a personalized prompt with your URL pre-baked. To get yours:

```bash
curl -sf http://localhost:8082/setup/agent-prompt?agent=openclaw
```

Or open the web UI's Connect page → OpenClaw tab → "Copy prompt" tab and click copy. Paste the result into a fresh OpenClaw session — the agent verifies the backend is reachable, installs via clawhub, configures the URL, runs the first sync, and reports back.

#### Method 2 — clawhub

For users who already use OpenClaw's plugin manager:

```bash
export SKILLNOTE_BASE_URL="http://localhost:8082"
clawhub install skillnote

# Make the env var persistent:
echo 'export SKILLNOTE_BASE_URL="http://localhost:8082"' >> ~/.zshrc
```

clawhub doesn't accept a host argument, so set `SKILLNOTE_BASE_URL` first — the skill reads it on first load via the layered host resolution (env → file → fail loudly). Auto-handles plugin updates via the daily version check baked into `sync.sh`.

#### Method 3 — curl one-liner

```bash
curl -sf http://localhost:8082/setup/agent | bash -s -- --agent openclaw
```

Same unified installer as Claude Code (just swap the `--agent` flag). Pre-fills config with your URL and kicks off the first sync. Use when `clawhub` isn't available or you want immediate visible "Synced N skills" feedback.

#### Method 4 — manual

```bash
# 1. Download bundle and extract into ~/.openclaw/skills/
mkdir -p ~/.openclaw/skills ~/.openclaw/skillnote
curl -sf http://localhost:8082/v1/openclaw-bundle.zip -o /tmp/skillnote.zip
unzip -qo /tmp/skillnote.zip -d ~/.openclaw/skills/
rm /tmp/skillnote.zip

# 2. Write config with your SkillNote URL
echo '{"host":"http://localhost:8082","user_id":"openclaw-main"}' \
  > ~/.openclaw/skillnote/config.json

# 3. Make sync.sh executable
chmod +x ~/.openclaw/skills/skillnote/sync.sh

# 4. Restart OpenClaw to pick up the skill
```

For air-gapped environments or when you want full control over each step.

#### What gets installed

| Path | Role |
| ---- | ---- |
| `~/.openclaw/skills/skillnote/` | The skill itself + `sync.sh` + `log-watcher.py` |
| `~/.openclaw/skills/sn-*/` | Per-skill mirrors synced from your registry every 60s |
| `~/.openclaw/skillnote/config.json` | Your registry URL and agent ID |
| `~/.openclaw/workspace/AGENTS.md` | Persistent `<skillnote v1>` block — keeps the registry active across sessions |

</details>

---

## Why Collections

Claude Code has a hard context budget for skills. With 15+ skills loaded, descriptions get truncated and [skills stop triggering reliably](https://github.com/anthropics/claude-code/issues/13343). You can't use all your skills at once. You have to pick.

Collections solve this. Instead of cluttering Claude's context with 30+ skills (half truncated), you scope 10 to 15 relevant skills per project.

<p align="center">
  <img src="docs/screenshots/collections.png" width="100%" alt="SkillNote collections with skill count and progress bars" />
</p>

Your frontend project gets React hooks and testing patterns. Your API project gets error handling and deploy conventions. Same registry, different active sets. No context wasted.

**How it works:**

- Create collections in the web UI: `Conventions`, `DevOps`, `Frontend`
- Each collection holds up to **15 skills** (the sweet spot before truncation kicks in)
- When you run `claude`, the plugin shows a picker. Select a collection for this project
- Saved in `.skillnote.json` so it persists across sessions
- If your folder name matches a collection, the plugin recommends it automatically

> Read more about Claude Code's skill description budget in the [official documentation](https://docs.anthropic.com/en/docs/claude-code/skills).

---

## Marketplace

The Claude Code community has already curated hundreds of `SKILL.md` files in public GitHub repos. SkillNote's **Marketplace** tab pulls them straight into your self-hosted registry with full provenance, per-skill selection, and safe upsert on re-install.

**Paste anything GitHub understands:**

- Shorthand: `garrytan/gstack`, `anthropics/skills`
- Full repo URL: `https://github.com/obra/superpowers-marketplace`
- Tree URL to a subfolder: `https://github.com/obra/superpowers/tree/main/skills`
- Claude Code marketplace manifest (`anthropic.json`)

Try any of these in the app: Garry Tan's 23-skill YC-flavored [`gstack`](https://github.com/garrytan/gstack), Jesse Vincent's [`superpowers`](https://github.com/obra/superpowers) agentic skills framework, or Anthropic's [`anthropics/skills`](https://github.com/anthropics/skills).

The inspector shallow-clones with sparse checkout (scoped to a subfolder if given), scans every `SKILL.md`, validates YAML frontmatter, and opens a full-page workspace before anything lands in your library.

<p align="center">
  <img src="docs/screenshots/marketplace-workspace-v3.png" width="100%" alt="Marketplace workspace after pasting garrytan/gstack: left rail shows 44 numbered skills with Select-all and filter, right pane previews the gstack skill with wrapped description and a syntax-highlighted Preamble section, footer picks the garrytan-gstack collection with an amber 44/15 over-cap banner" />
</p>

In the workspace you filter and pick exactly which skills to install, preview each `SKILL.md` rendered exactly as it will appear post-install, and choose an existing collection from a Jira-style combobox with fuzzy match or create a new one inline (the inferred slug is tagged **Recommended**). An amber warning fires if you exceed the 15-skill cap, with a one-click suggestion to split into themed collections.

---

## Agent Reviews

Most skill setups are fire and forget. You write a skill, hope it triggers, and never hear back. 73% of community skills score below 60/100 in audits because nobody knows what's working.

SkillNote closes the feedback loop. After applying a skill, Claude rates it 1 to 5 and describes what it did. Every skill page shows reviews with star distribution, individual cards, agent names, versions, and timestamps.

<p align="center">
  <img src="docs/screenshots/skill-detail.png" width="100%" alt="Skill detail page with Amazon-style agent reviews and star ratings" />
</p>

This tells you which skills are actually being used, which ones work well, and how performance changes across versions. Skills get better over time because you have real signal, not guesswork.

---

## Live Sync

Edit a skill in the browser and every running Claude Code session picks up the change within 60 seconds. No restarts, no manual copying, no "did you pull the latest skills?"

The plugin runs a background sync on every prompt. When it detects changes on the server, it updates the local `SKILL.md` files and Claude hot-reloads them mid-session. This works across your whole team. One person updates a skill, everyone gets it.

Onboarding is instant. A new teammate runs the setup command, picks a collection, and has every skill the team has built. No Slack messages asking "where's the deploy checklist?" No discovering missing skills only when something breaks.

---

## Skill Push

When Claude notices you repeating the same instruction, it offers to turn it into a skill. The skill gets pushed to SkillNote and syncs to every connected agent within 60 seconds.

```
User: "use pnpm not npm"  (3rd time)
Claude: "Want me to create a skill for this?"
        drafts it, you review, pick a collection, published.
```

Your team's knowledge compounds. What one person corrects once becomes a skill everyone benefits from. Tribal knowledge stops walking out the door.

---

## OpenClaw Integration

SkillNote ships a native integration for [OpenClaw](https://github.com/openclaw/openclaw), the open-source chat-first AI agent runtime.

Once installed, your OpenClaw agent automatically:

- Consults your SkillNote registry before each task and applies the relevant skills
- Logs every skill it uses so you can see real activity in the web UI
- Leaves one-line observations and ratings on skills it found helpful or stale

No prompts, no collection pickers. The agent picks skills on its own — you're only involved when confidence is low or a skill carries risk.

### Install

See the **Connect OpenClaw** section in [Quick Start](#quick-start) above for all four install methods (clawhub, curl, manual, agent prompt).

The single `skillnote` skill includes:

- **`SKILL.md`** — always-injected instructions teaching OpenClaw when to consult the registry and how to rate skills
- **`sync.sh`** — fetches the catalog every 60s, writes per-skill mirrors to `~/.openclaw/skills/sn-*/`
- **`log-watcher.py`** — background daemon that parses session JSONL to track which skills the agent actually read

No subagent or LLM resolver step — OpenClaw reads the synced `sn-*/SKILL.md` files directly via its native skill system.

### What you see

- **Settings → OpenClaw**: live connection status. Green dot means the agent can reach your registry.
- **Analytics**: usage events appear here as the agent works.
- **Skill pages → Reviews tab**: agent observations (`agent_observation`, `agent_issue`, `agent_success_note`) appear alongside your human reviews.

---

## The Web UI

### Dashboard & Editor

Browse all skills with search, collection filters, and ratings at a glance. Edit with a Notion-style WYSIWYG editor or raw markdown. Import existing `SKILL.md` files with drag and drop.

<p align="center">
  <img src="docs/screenshots/hero-dashboard.png" width="100%" alt="SkillNote dashboard with skill list, search, and collection filter" />
</p>

### Analytics

Track which skills are used, how often, and by which agents. See call counts, average ratings, agent breakdown, and activity timeline. Filter by time range, agent, or collection.

<p align="center">
  <img src="docs/screenshots/analytics-dashboard.png" width="100%" alt="SkillNote analytics dashboard with usage stats and agent breakdown" />
</p>

### Version History

Every save creates a snapshot. Browse, compare, and restore any previous version in one click.

<p align="center">
  <img src="docs/screenshots/version-history.png" width="100%" alt="Skill version history with restore" />
</p>

---

## Built on Claude Code's Native APIs

SkillNote isn't a wrapper or a workaround. It's built directly on [Claude Code's plugin system](https://docs.anthropic.com/en/docs/claude-code/plugins), [hooks](https://docs.anthropic.com/en/docs/claude-code/hooks), and [skill format](https://docs.anthropic.com/en/docs/claude-code/skills). Every feature uses the official APIs, so the experience feels native, not bolted on.

### Six Lifecycle Hooks

Most tools use one or two hooks. SkillNote uses all six to keep skills current, track usage, and preserve context through compaction and subagent spawning.

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│   SkillNote Server (Docker)                          │
│                                                      │
│   Web UI        REST API       PostgreSQL            │
│   :3000         :8082          (storage + notify)    │
│                                                      │
└────────────────────┬─────────────────────────────────┘
                     │
                  REST API
                     │
┌────────────────────┴─────────────────────────────────┐
│                                                      │
│   SkillNote Plugin (on your machine)                 │
│                                                      │
│   SessionStart      Sync all skills on launch        │
│   UserPromptSubmit  Background re-sync every 60s     │
│   PostToolUse       Track which skills get used      │
│   PostCompact       Re-inject context after compact  │
│   SubagentStart     Share context with subagents     │
│   Stop              Prompt agent to rate skills      │
│                                                      │
│   Writes to: ~/.claude/skills/skillnote-*/SKILL.md   │
│   Supports:  allowed-tools, context, effort, model   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Full Frontmatter Support

Skills are written as local `SKILL.md` files, not piped through an abstraction layer. Every [Claude Code frontmatter feature](https://docs.anthropic.com/en/docs/claude-code/skills) works:

- **`allowed-tools`** to restrict which tools a skill can use
- **`context: fork`** to isolate skill execution in a separate context
- **`effort`** to control how much reasoning the agent applies
- **`model`** to pin a skill to a specific model

These features only work with local `SKILL.md` files, not with MCP tools or remote APIs. That's why SkillNote syncs to disk instead of serving skills over a network protocol.

### Non-blocking by Design

Only `SessionStart` blocks (for ~1 second to sync). Every other hook runs asynchronously. You never wait for SkillNote.

---

## Coming Soon

SkillNote is built for Claude Code today. Native plugins for other agents are on the roadmap.

| Agent | Status |
| --- | --- |
| **Claude Code** | Supported |
| **OpenClaw** | Supported |
| **Cursor** | Planned |
| **Codex CLI** | Planned |
| **Antigravity** | Planned |
| **OpenHands** | Planned |

Want to help build an adapter? [Open an issue](https://github.com/luna-prompts/skillnote/issues) or join us on [Discord](https://discord.gg/GazU4amU6H).

---

## SKILL.md Format

```markdown
---
name: pdf-extractor
description: Extract text and tables from PDF files. Use when the user mentions PDFs or scanned documents.
collections: [data, documents]
allowed-tools: Read Write Bash(pdftotext *)
context: fork
---

# PDF Extractor

When the user provides a PDF file:
1. Use `pdftotext` to extract raw text
2. Identify tables and format them as markdown
3. Preserve headings and document structure
```

---

## FAQ

**Skills from another collection are showing up**

Claude Code discovers skills from parent directories. If you previously ran `claude` in a parent folder (like `~/projects/`) and picked a collection, those skills persist in `~/projects/.claude/skills/` and leak into every subdirectory project.

Fix: remove the stale skills from the parent directory.

```bash
rm -rf ~/path/to/parent/.claude/skills/skillnote-*
```

To avoid this, always run `claude` from the actual project directory, not from umbrella folders that contain multiple projects.

**Plugin changes not taking effect**

Claude Code loads plugins at startup. If you reinstall the plugin while Claude Code is running, quit and restart Claude Code for the new plugin to load.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4, Tiptap |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, Alembic |
| Plugin | Bash, Python, Claude Code Plugin API |
| Database | PostgreSQL 16 |
| Infra | Docker Compose |

---

## Contributing

1. Fork the repo
2. `git checkout -b feat/my-feature`
3. Commit with [Conventional Commits](https://www.conventionalcommits.org/)
4. Push and open a PR

Join us on [Discord](https://discord.gg/GazU4amU6H).

---

## License

MIT &copy; [Luna Prompts](https://github.com/luna-prompts)

---

<p align="center">
  <br />
  <a href="https://github.com/luna-prompts/skillnote"><img src="https://img.shields.io/github/stars/luna-prompts/skillnote?style=for-the-badge&logo=github&label=Star%20us" alt="Star us" /></a>
  <br /><br />
  Built with ❤️ by <a href="https://github.com/luna-prompts"><strong>Luna Prompts</strong></a>
</p>
