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
  <a href="#why-collections">Why Collections</a> &middot;
  <a href="#agent-reviews">Agent Reviews</a> &middot;
  <a href="#the-web-ui">Web UI</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="#contributing">Contributing</a>
</p>

---

## The Problem

Claude Code loads every `SKILL.md` in `~/.claude/skills/` into context. But there's a hard limit: [**~8,000 characters**](https://docs.anthropic.com/en/docs/build-with-claude/claude-code/tutorials/manage-skills) shared across all active skill descriptions. Past that, descriptions get silently truncated and skills stop triggering.

With 15+ skills, you're already at the edge. Add team-shared skills on top and it breaks entirely. You can't use all your skills at once. You need a way to pick which ones are active.

And then there's the skills you can't put on GitHub at all. Internal deploy procedures, proprietary API patterns, compliance workflows, credentials handling, infra runbooks. These encode institutional knowledge that needs to stay on your infrastructure, not in a public repo or a third-party registry.

**SkillNote** is a self-hosted skill registry that solves both problems. It gives you a private registry for skills that can't leave your network, collections to scope them per project, and a plugin that syncs exactly what's needed to each Claude Code session.

Your skills. Your servers. Your rules.

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

## Why Collections

Every project has different needs. Your frontend project needs React hooks and testing patterns, not your Docker deploy checklist. Your API project needs error handling conventions, not your CSS guidelines.

Collections let you group skills by purpose and activate a different set per project. Instead of cluttering Claude's context with 30+ skills (half of which will be truncated anyway), you scope 10 to 15 relevant skills per project.

<p align="center">
  <img src="docs/screenshots/collections.png" width="100%" alt="Collections" />
</p>

**How it works in practice:**

- You create collections in the web UI: `Conventions`, `DevOps`, `Frontend`, etc.
- Each collection holds up to **15 skills** (the sweet spot for Claude Code's context budget)
- When you run `claude`, the plugin shows a picker. You select a collection for this project
- The selection is saved in `.skillnote.json` so it persists across sessions
- If your folder name matches a collection name, the plugin recommends it automatically

One project can use `Frontend + Conventions`. Another can use `DevOps`. Same skill registry, different active sets. No context wasted.

> Read more about Claude Code's skill context limits in the [official documentation](https://docs.anthropic.com/en/docs/build-with-claude/claude-code/tutorials/manage-skills).

---

## Agent Reviews

Most skill systems are fire and forget. You write a skill, hope it works, and never hear back. SkillNote closes the loop.

After applying a skill, Claude rates it 1 to 5 and describes what it did. Every skill page shows an Amazon-style reviews section with star distribution, individual review cards, agent names, versions, and timestamps.

<p align="center">
  <img src="docs/screenshots/skill-detail.png" width="100%" alt="Skill detail with agent reviews" />
</p>

This tells you:
- Which skills are actually being used
- Which ones work well and which need revision
- How performance changes across versions

Skills get better over time because you have real signal, not guesswork.

---

## Skill Push

When Claude notices you repeating the same instruction, it offers to turn it into a skill. The skill gets pushed to SkillNote and syncs to every connected agent within 60 seconds.

```
User: "use pnpm not npm"  (3rd time)
Claude: "Want me to create a skill for this?"
        drafts it, you review, pick a collection, published.
```

Your team's knowledge compounds. What one person corrects once becomes a skill everyone benefits from.

---

## The Web UI

### Dashboard & Editor

Browse all skills with search, collection filters, and ratings at a glance. Edit with a Notion-style WYSIWYG editor or raw markdown. Import existing `SKILL.md` files with drag and drop.

<p align="center">
  <img src="docs/screenshots/hero-dashboard.png" width="100%" alt="Dashboard" />
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

Skills are written as local `SKILL.md` files with full [Claude Code frontmatter](https://docs.anthropic.com/en/docs/build-with-claude/claude-code/tutorials/manage-skills) support. Features like `allowed-tools`, `context: fork`, `effort`, and `model` all work out of the box. Skills persist offline and survive restarts.

The plugin runs a background sync every 60 seconds. Edit a skill in the web UI and Claude has the new version within a minute.

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
  <a href="https://github.com/luna-prompts/skillnote"><img src="https://img.shields.io/github/stars/luna-prompts/skillnote?style=for-the-badge&logo=github&label=Star%20on%20GitHub" alt="Star on GitHub" /></a>
  <br /><br />
  Built with ❤️ by <a href="https://github.com/luna-prompts"><strong>Luna Prompts</strong></a>
  <br />
  <sub>If SkillNote helps your workflow, a star goes a long way.</sub>
</p>
