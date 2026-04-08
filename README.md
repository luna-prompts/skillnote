<p align="center">
  <img src="public/logo.svg" width="80" height="80" alt="SkillNote" />
</p>

<h1 align="center">SkillNote</h1>

<p align="center">
  <strong>The open-source skill registry for AI coding agents.</strong>
  <br />
  Create, version, and distribute <code>SKILL.md</code> files across your team — with a Claude Code plugin that syncs them automatically.
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
  <img src="docs/terminal/picker.png" width="680" alt="SkillNote in Claude Code" />
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#what-you-get">What You Get</a> &middot;
  <a href="#the-web-ui">Web UI</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="#self-hosting">Self-Hosting</a> &middot;
  <a href="#contributing">Contributing</a>
</p>

---

## Why SkillNote?

AI coding agents use `SKILL.md` files to learn conventions, workflows, and patterns. But managing them is a mess — scattered files, no versioning, no sharing, no way to know what actually works.

**SkillNote** is a self-hosted registry that gives you:

- A **web UI** to create, edit, and version skills with a Notion-style editor
- A **Claude Code plugin** that syncs skills to every session automatically
- **Agent reviews** — AI agents rate skills after use, so you know what's working
- **Per-project scoping** — each project gets the right skills, nothing more

One setup command. Skills sync everywhere, every session. Agents get better over time.

---

## Quick Start

```bash
git clone https://github.com/luna-prompts/skillnote.git
cd skillnote
docker compose up --build -d
```

Connect Claude Code:

```bash
curl -sf http://localhost:8082/setup | bash
source ~/.zshrc
```

<p align="center">
  <img src="docs/terminal/setup.png" width="680" alt="SkillNote setup" />
</p>

Now run `claude` in any project. SkillNote picks up your skills automatically.

> **Team setup:** `SKILLNOTE_HOST=<your-server-ip> docker compose up --build -d`, then each person runs `curl -sf http://<your-server-ip>:8082/setup | bash`

---

## What You Get

### Skills sync to every Claude Code session

The plugin writes `SKILL.md` files to `~/.claude/skills/` with full frontmatter support — `allowed-tools`, `context: fork`, `effort`, `model`. Skills are always current: they sync at session start and refresh in the background every 60 seconds.

### Scope the right skills to each project

Group skills into collections (Conventions, DevOps, Frontend, etc.). Each project gets one active collection via a `.skillnote.json` file. The plugin auto-detects matching collections based on your folder name.

Claude Code has a ~8,000 character budget for skill descriptions. With 15+ skills, descriptions get truncated and skills stop triggering. Collections keep things focused — 15 skills max per collection.

### Agents rate skills after use

After applying a skill, Claude rates it 1-5 and describes what it did. Over time you see which skills work, which need revision, and how they perform across versions. Real feedback, not guesswork.

<p align="center">
  <img src="docs/screenshots/skill-detail.png" width="100%" alt="Skill detail with agent reviews" />
</p>

### Create skills from conversations

When Claude notices you repeating the same instruction, it offers to turn it into a skill. The skill gets pushed to SkillNote and syncs to every connected agent within 60 seconds.

```
User: "use pnpm not npm"  (3rd time)
Claude: "Want me to create a skill for this?"
      → drafts → you review → pick a collection → published
```

---

## The Web UI

### Dashboard & Editor

Browse all skills. Search, filter by collection, see ratings at a glance. Edit with a Notion-style WYSIWYG editor or raw markdown. Import existing `SKILL.md` files with drag-and-drop.

<p align="center">
  <img src="docs/screenshots/hero-dashboard.png" width="100%" alt="Dashboard" />
</p>

### Collections

Organize skills by purpose. Each collection shows a progress bar (X/15 skills) and the skills it contains.

<p align="center">
  <img src="docs/screenshots/collections.png" width="100%" alt="Collections" />
</p>

### Analytics

Track usage across all connected agents. Calls, ratings, agent breakdown, timeline — filterable by time range, agent, and collection.

<p align="center">
  <img src="docs/screenshots/analytics-dashboard.png" width="100%" alt="Analytics" />
</p>

### Version History

Every save creates a snapshot. Browse, compare, and restore any version.

<p align="center">
  <img src="docs/screenshots/version-history.png" width="100%" alt="Version history" />
</p>

---

## How It Works

The Claude Code plugin installs to `~/.claude/plugins/skillnote` and sets up six lifecycle hooks:

| Hook | What it does |
|------|-------------|
| **SessionStart** | Syncs skills from SkillNote to `~/.claude/skills/` |
| **UserPromptSubmit** | Background re-sync every 60s (non-blocking) |
| **PostToolUse** | Tracks skill usage for analytics |
| **PostCompact** | Re-injects skill context after compaction |
| **SubagentStart** | Injects context into subagents |
| **Stop** | Prompts agent to rate skills used |

The plugin also connects via MCP for real-time features: skill ratings (`complete_skill`) and skill creation (`skill-push`).

```
┌──────────────────────────────────────────────────┐
│  SkillNote Server (Docker)                       │
│  Web UI :3000  ·  REST API :8082  ·  MCP :8083   │
│  PostgreSQL (pg_notify for real-time)             │
└──────────────────────┬───────────────────────────┘
                       │
          REST API + MCP protocol
                       │
┌──────────────────────┴───────────────────────────┐
│  Claude Code Plugin                              │
│  6 hooks · MCP · skill sync · status line        │
│  → ~/.claude/skills/skillnote-*/SKILL.md         │
└──────────────────────────────────────────────────┘
```

### Why both local files and MCP?

Local skills support `allowed-tools`, `context: fork`, `effort`, and `model` — MCP tools don't. Local skills also work offline. MCP provides real-time delivery and the ratings API. The plugin gives you both.

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

## Other Agents

Any MCP-compatible agent can connect. Skills appear as tools.

```json
{"mcpServers": {"skillnote": {"url": "http://localhost:8083/mcp"}}}
```

> MCP agents get skills and ratings but not local sync features (`allowed-tools`, `context: fork`). Those require the Claude Code plugin.

---

## Self-Hosting

### Requirements

~250 MB RAM idle, ~420 MB under load. ~1.9 GB disk for images.

### Docker Compose

```bash
git clone https://github.com/luna-prompts/skillnote.git
cd skillnote
docker compose up --build -d
# Web: localhost:3000 · API: localhost:8082 · MCP: localhost:8083
```

**Custom host:**
```bash
SKILLNOTE_HOST=<your-server-ip> docker compose up --build -d
```

**Local dev:**
```bash
docker compose up --build -d postgres api mcp
npm install && npm run dev
```

### Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `SKILLNOTE_HOST` | `localhost` | Host IP/domain for CORS and frontend |
| `SKILLNOTE_API_PORT` | `8082` | API port |
| `SKILLNOTE_MCP_PORT` | `8083` | MCP server port |
| `SKILLNOTE_DATABASE_URL` | *(compose)* | PostgreSQL connection string |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8082` | Frontend API endpoint |

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4, Tiptap |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, Alembic |
| MCP Server | Python 3.12, FastMCP |
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

<p align="center">
  <a href="https://github.com/luna-prompts/skillnote"><img src="https://img.shields.io/github/stars/luna-prompts/skillnote?style=for-the-badge&logo=github&label=Star%20on%20GitHub" alt="Star on GitHub" /></a>
</p>
