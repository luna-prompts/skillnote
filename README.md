<p align="center">
  <img src="public/logo.svg" width="80" height="80" alt="SkillNote" />
</p>

<h1 align="center">S K I L L N O T E</h1>

<p align="center">
  <strong>The open-source skill registry for AI coding agents.</strong>
  <br />
  Create, version, and distribute <code>SKILL.md</code> files across your team with a Claude Code plugin that syncs them automatically.
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

AI coding agents use `SKILL.md` files to learn conventions, workflows, and patterns. But managing them is a mess. Files are scattered, there's no versioning, no sharing, and no way to know what actually works.

**SkillNote** is a self-hosted registry that gives you:

- A **web UI** to create, edit, and version skills with a Notion-style editor
- A **Claude Code plugin** that syncs skills to every session automatically
- **Agent reviews** where AI agents rate skills after use, so you know what's working
- **Per-project scoping** so each project gets the right skills, nothing more

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

Now run `claude` in any project. SkillNote picks up your skills automatically.

---

## What You Get

### Skills sync to every Claude Code session

The plugin writes `SKILL.md` files to `~/.claude/skills/` with full frontmatter support including `allowed-tools`, `context: fork`, `effort`, and `model`. Skills are always current. They sync at session start and refresh in the background every 60 seconds.

### Scope the right skills to each project

Group skills into collections like Conventions, DevOps, or Frontend. Each project gets one active collection via a `.skillnote.json` file. The plugin auto-detects matching collections based on your folder name.

Claude Code has a ~8,000 character budget for skill descriptions. With 15+ skills, descriptions get truncated and skills stop triggering. Collections keep things focused with a 15 skill maximum per collection.

### Agents rate skills after use

After applying a skill, Claude rates it 1 to 5 and describes what it did. Over time you see which skills work, which need revision, and how they perform across versions. Real feedback, not guesswork.

<p align="center">
  <img src="docs/screenshots/skill-detail.png" width="100%" alt="Skill detail with agent reviews" />
</p>

### Create skills from conversations

When Claude notices you repeating the same instruction, it offers to turn it into a skill. The skill gets pushed to SkillNote and syncs to every connected agent within 60 seconds.

```
User: "use pnpm not npm"  (3rd time)
Claude: "Want me to create a skill for this?"
        drafts it, you review, pick a collection, published.
```

---

## The Web UI

### Dashboard & Editor

Browse all skills. Search, filter by collection, see ratings at a glance. Edit with a Notion-style WYSIWYG editor or raw markdown. Import existing `SKILL.md` files with drag and drop.

<p align="center">
  <img src="docs/screenshots/hero-dashboard.png" width="100%" alt="Dashboard" />
</p>

### Collections

Organize skills by purpose. Each collection shows a progress bar and the skills it contains. Capped at 15 for optimal Claude Code performance.

<p align="center">
  <img src="docs/screenshots/collections.png" width="100%" alt="Collections" />
</p>

### Analytics

Track usage across all connected agents. Calls, ratings, agent breakdown, and timeline. Filterable by time range, agent, and collection.

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

The SkillNote plugin installs to `~/.claude/plugins/skillnote` and hooks into six points in Claude Code's lifecycle. No manual config needed.

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

Skills are written as local `SKILL.md` files with full Claude Code frontmatter support. This means features like `allowed-tools`, `context: fork`, `effort`, and `model` all work out of the box. Skills also persist offline and survive restarts.

The plugin runs a background sync every 60 seconds. Edit a skill in the web UI and Claude has the new version within a minute, with zero restarts.

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

**Custom host (LAN or Tailscale):**
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
| `SKILLNOTE_HOST` | `localhost` | Host IP or domain for CORS and frontend |
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

---

<p align="center">
  <br />
  <a href="https://github.com/luna-prompts/skillnote"><img src="https://img.shields.io/github/stars/luna-prompts/skillnote?style=for-the-badge&logo=github&label=Star%20on%20GitHub" alt="Star on GitHub" /></a>
  <br /><br />
  Built with ❤️ by <a href="https://github.com/luna-prompts"><strong>Luna Prompts</strong></a>
  <br />
  <sub>If SkillNote helps your workflow, a star goes a long way.</sub>
</p>
