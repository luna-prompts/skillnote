<p align="center">
  <img src="public/logo.svg" width="80" height="80" alt="SkillNote" />
</p>

<h1 align="center">SkillNote</h1>

<p align="center">
  <strong>The open-source skill registry for AI coding agents.</strong>
  <br />
  Create, manage, and distribute <code>SKILL.md</code> files — with a Claude Code plugin that makes it seamless.
</p>

<p align="center">
  <a href="https://github.com/luna-prompts/skillnote/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  <a href="https://github.com/luna-prompts/skillnote"><img src="https://img.shields.io/github/stars/luna-prompts/skillnote?style=social" alt="Stars" /></a>
  <a href="https://github.com/luna-prompts/skillnote/issues"><img src="https://img.shields.io/github/issues/luna-prompts/skillnote" alt="Issues" /></a>
  <a href="https://discord.gg/GazU4amU6H"><img src="https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
  <img src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker Ready" />
  <img src="https://img.shields.io/badge/self--hosted-yes-green" alt="Self-hosted" />
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &nbsp;&middot;&nbsp;
  <a href="#how-it-works">How It Works</a> &nbsp;&middot;&nbsp;
  <a href="#collections--per-project-scoping">Collections</a> &nbsp;&middot;&nbsp;
  <a href="#skill-push">Skill Push</a> &nbsp;&middot;&nbsp;
  <a href="#features">Features</a> &nbsp;&middot;&nbsp;
  <a href="#self-hosting">Self-Hosting</a> &nbsp;&middot;&nbsp;
  <a href="#contributing">Contributing</a>
</p>

<br />

---

## Why SkillNote?

AI coding agents like Claude Code use `SKILL.md` files to learn new capabilities. But managing these files is painful:

- They live scattered across `~/.claude/skills/` with no versioning or search
- No way to share across projects, machines, or teams
- Writing good skills from scratch means guessing what works — no feedback on what agents actually use

**SkillNote fixes this.** It's a self-hosted registry with a web UI for managing skills, a Claude Code plugin that auto-syncs everything, and a built-in feedback loop where agents rate skills after use. One setup command, then skills just work — everywhere, every session.

**Why self-hosted?** Your skills encode institutional knowledge — coding conventions, deploy workflows, project-specific patterns. That shouldn't leave your infrastructure. SkillNote runs entirely on your machines.

<p align="center">
  <img src="docs/screenshots/hero-dashboard.png" width="100%" alt="SkillNote Dashboard" />
</p>

---

## Quick Start

```bash
git clone https://github.com/luna-prompts/skillnote.git
cd skillnote
docker compose up --build -d
```

Then connect Claude Code:

```bash
curl -sf http://localhost:8082/setup | bash
```

That's it. Start `claude` in any project — your skills are there.

> **LAN/team setup:** Replace `localhost` with your server IP: `curl -sf http://<your-server-ip>:8082/setup | bash`

---

## How It Works

SkillNote delivers skills to Claude Code through a **plugin** that combines three mechanisms — each handling what it does best:

```
┌─────────────────────────────────────────────────────────────┐
│  SkillNote Server (Docker)                                  │
│                                                             │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐               │
│  │  Web UI   │  │  REST API │  │ MCP Server│               │
│  │  :3000    │  │  :8082    │  │  :8083    │               │
│  └───────────┘  └─────┬─────┘  └─────┬─────┘               │
│                       │              │                      │
│                  PostgreSQL          │                      │
│                  pg_notify ──────────┘                      │
└─────────────────────────────────────────────────────────────┘
                        │              │
                   REST API        MCP protocol
                        │              │
┌─────────────────────────────────────────────────────────────┐
│  Claude Code Plugin (on your machine)                       │
│                                                             │
│  SessionStart hook ─── curls REST API ──→ writes SKILL.md   │
│  UserPromptSubmit ──── background re-sync every 60s         │
│  PostToolUse[Skill] ── tracks usage via REST API            │
│  MCP connection ────── ratings (complete_skill)             │
│                                                             │
│  Result: ~/.claude/skills/{slug}/SKILL.md                   │
│          with full frontmatter (allowed-tools, fork, etc.)  │
└─────────────────────────────────────────────────────────────┘
```

### The Plugin

The `curl .../setup | bash` command creates a [Claude Code plugin](https://code.claude.com/docs/en/plugins-reference) in `~/.claude/plugins/`. The plugin bundles everything — no separate MCP setup, no manual config, no hook scripts to write. One install, works globally in every project.

### Three Hooks, One Seamless Experience

| Hook | When it fires | What it does | Blocking? |
|------|---------------|-------------|-----------|
| **SessionStart** | Session start + after compaction | Syncs skills to `~/.claude/skills/` with full frontmatter. On first visit, detects if folder name matches a collection and prompts to scope. | Yes (fast — ~1s) |
| **UserPromptSubmit** | Every prompt | Background re-sync if >60s since last sync. If skills changed on the server, local files update and Claude hot-reloads them. | **No** (async) |
| **PostToolUse[Skill]** | After any skill is used | Posts usage event to SkillNote analytics | **No** (async) |

The `SessionStart` hook ensures skills are always current on session start. The `UserPromptSubmit` hook catches mid-session changes — edit a skill in the web UI, and Claude has the new version within 60 seconds. Neither the `UserPromptSubmit` nor `PostToolUse` hooks ever block the user.

### MCP Connection

The plugin also connects to SkillNote's MCP server. This handles:

- **`complete_skill`** — agents rate skills (1-5) after applying them, with optional outcome text
- **`skill-push`** — agents create new skills from conversations (the MCP server substitutes `{{API_URL}}` placeholders with real URLs at serve time)
- **Real-time tool list** — `pg_notify` pushes `notifications/tools/list_changed` to connected agents when skills change

### Why Both Local Skills AND MCP?

| | Local Skills (via plugin sync) | MCP Tools |
|---|---|---|
| **`allowed-tools`** | Enforced | Not supported |
| **`context: fork`** | Works | Not supported |
| **`effort`, `model`** | Works | Not supported |
| **Update speed** | ~60s (background sync) | Instant (real-time) |
| **Offline** | Works (persisted on disk) | Needs network |

Local skills get full Claude Code features. MCP gets real-time delivery and ratings. The plugin gives you both — local skills as the primary path (for features), MCP as the real-time supplement (for ratings and instant updates).

### What Claude Sees

**First time in a project folder:**

```
$ cd ~/projects/frontend
$ claude

SkillNote: Collection 'frontend' matches this folder.     ← folder name = collection
Claude: "Want to scope to frontend skills?"                ← AskUserQuestion picker
User: [picks frontend] → Enter
SkillNote: 12 skills synced.                               ← .skillnote.json created
```

**Every session after:**

```
$ claude

SkillNote: 12 skills (all current)       ← SessionStart hook (fast, ~1s)

claude> help me validate this API payload
        ← Claude reads skill descriptions from ~/.claude/skills/
        ← Auto-triggers 'use-zod-validation' based on description match
        ← allowed-tools: Read Write Grep — enforced by Claude Code
        ← PostToolUse fires → usage tracked in SkillNote

claude> [next prompt, 60s later]
        ← UserPromptSubmit fires (async) → checks for skill updates
        ← If skills changed on server → files updated → Claude hot-reloads
```

---

## Skill Reviews & Ratings

After an agent uses a skill, it rates it (1-5 stars) and optionally describes what it did:

```
Agent uses skill  →  complete_skill(rating: 4, outcome: "built auth flow")  →  SkillNote
```

- **Per-version ratings** — see how each version of a skill performs
- **Agent reviews** — read what agents actually did with the skill
- **Analytics dashboard** — top skills, rating distribution, trends over time
- **Settings control** — toggle rating collection on/off

Skills get better over time because you have real feedback, not guesswork.

---

## Skill Push

Agents create new skills directly from conversations. When Claude notices you giving the same instruction repeatedly, it offers to save it:

```
User: "use pnpm not npm"  (3rd time this session)

Claude: "I've noticed you keep correcting me about pnpm.
         Want me to create a skill for this?"

User: "yes"

Claude: → drafts the skill
        → shows you for review
        → you pick a collection
        → pushes to SkillNote
        → "Done! 'use-pnpm' is live. All agents get it within 60 seconds."
```

The MCP server instructions tell Claude to watch for repeated patterns:
> *"When you notice the user giving the same instruction repeatedly, suggest creating a reusable skill using the skill-push tool."*

**Plugin skills & agents:**

| Command | What it does |
|---------|-------------|
| **`/skillnote:collection`** | Pick which collections are active — native arrow-key picker with multi-select |
| **`/skillnote:skill-push`** | Quick capture — 6-step guided flow for creating skills from conversations |
| **`/skillnote:skill-creator`** | Deep creation — dedicated agent with `effort: high` and `memory: project` |

Toggle skill creation on/off in **Settings > MCP Tools > Allow Agents to Create Skills**.

---

## Collections & Per-Project Scoping

Claude Code has a ~8,000 character budget for skill descriptions. With more than ~15 skills, descriptions get silently truncated and skills stop triggering. Collections keep things focused.

### Automatic Collection Selection

On the first session in a new project folder, the plugin checks if the **folder name matches a collection name** in the registry. If it does, Claude offers to scope the project:

```
$ cd ~/projects/frontend
$ claude

SkillNote: Collection 'frontend' matches this folder.

Claude: "SkillNote found a 'frontend' collection matching this folder.
         Want me to scope this project to frontend skills?"

  ┌──────────────────────────────────────────┐
  │  Which collections for this project?      │
  │                                          │
  │  ▸ frontend (Recommended)                │
  │    conventions                            │
  │    All skills                            │
  │                                          │
  │  ↑↓ to move, Space to select, Enter     │
  └──────────────────────────────────────────┘

User: [selects frontend + conventions] → Enter

Claude: → writes .skillnote.json → skills sync → "Done! 17 → 12 skills."
```

If the folder name doesn't match but you have >15 skills, Claude shows the picker anyway to help you scope.

### Change Collection Mid-Session

```
claude> change collection
```

Claude calls `/skillnote:collection` which shows the same picker. Selection updates `.skillnote.json` and skills refresh within 60 seconds.

### Manual `.skillnote.json`

You can also create it directly:

```json
{"collections": ["frontend", "conventions"]}
```

The plugin checks this file on every sync. Edit it and the next sync reflects the change. Remove it to go back to global (all skills).

---

## Advanced Metadata

The skill editor has an **Advanced Metadata** section for Claude Code frontmatter:

```yaml
allowed-tools: Read Write Grep
context: fork
effort: high
model: claude-sonnet-4-6
```

These fields are stored in `extra_frontmatter` and written into local `SKILL.md` frontmatter by the sync hook. They only take effect for locally-installed skills — this is why the plugin syncs to disk instead of relying solely on MCP.

---

## Features

### Skill Editor
A Notion-style WYSIWYG editor powered by Tiptap. Write in rich text or switch to raw markdown. Paste a raw `SKILL.md` file and it auto-extracts the name, description, and body from the frontmatter.

<p align="center">
  <img src="docs/screenshots/skill-editor.png" width="100%" alt="Skill Editor" />
</p>

### Version History
Every save creates a snapshot. Browse the full history, compare versions, and restore any previous state with one click. Each version shows its average rating and agent reviews inline.

<p align="center">
  <img src="docs/screenshots/version-history.png" width="100%" alt="Version History" />
</p>

### Analytics
Track how your skills are used across every connected agent. Total calls, unique skills invoked, active agents, skill leaderboard with ratings, agent breakdown, rating distribution, activity timeline — all filterable by time range.

<p align="center">
  <img src="docs/screenshots/analytics-dashboard.png" width="100%" alt="Analytics Dashboard" />
</p>

### Collections
Organise skills into collections. Filter, search, and browse by category. Use collections with `.skillnote.json` for per-project scoping.

### MCP Integrations
The **Integrations** page shows plugin install commands, per-agent MCP config snippets, collection-filtered URLs, and a live connection monitor showing every connected agent with call counts and session duration.

<p align="center">
  <img src="docs/screenshots/mcp-integrations.png" width="100%" alt="MCP Integrations" />
</p>

---

## SKILL.md Format

```markdown
---
name: pdf-extractor
description: Extract text and tables from PDF files. Use when the user mentions PDFs, scanned documents, or form extraction.
collections: [data, documents]
---

# PDF Extractor

When the user provides a PDF file:

1. Use `pdftotext` to extract raw text
2. Identify tables and format them as markdown
3. Preserve headings and document structure
```

With Advanced Metadata (synced locally via the plugin):

```yaml
---
name: pdf-extractor
description: Extract text and tables from PDF files.
allowed-tools: Read Write Bash(pdftotext *)
context: fork
effort: high
---
```

---

## Other Agents

Any MCP-compatible agent can connect directly to SkillNote. Skills appear as MCP tools.

```bash
# OpenClaw
openclaw mcp add --transport http skillnote http://localhost:8083/mcp --scope user

# Cursor — add to ~/.cursor/mcp.json
{"mcpServers": {"skillnote": {"url": "http://localhost:8083/mcp"}}}

# Any agent with MCP HTTP support
http://localhost:8083/mcp
```

> Other agents get skills via MCP (real-time updates, ratings) but not the local sync features (`allowed-tools`, `context: fork`, etc.). Those require the Claude Code plugin.

---

## Self-Hosting

### System Requirements

| Container    | Image size | RAM (idle) | RAM (under load) |
| ------------ | ---------- | ---------- | ---------------- |
| **Web**      | ~302 MB    | ~37 MB     | ~60 MB           |
| **API**      | ~456 MB    | ~71 MB     | ~120 MB          |
| **MCP**      | ~456 MB    | ~104 MB    | ~160 MB          |
| **Postgres** | ~663 MB    | ~38 MB     | ~80 MB           |
| **Total**    | ~1.9 GB    | **~250 MB**| **~420 MB**      |

### Docker Compose

```bash
git clone https://github.com/luna-prompts/skillnote.git
cd skillnote
docker compose up --build -d
```

#### Custom host

```bash
SKILLNOTE_HOST=<your-server-ip> docker compose up --build -d
```

#### Stop & reset

```bash
docker compose down          # Stop (keeps data)
docker compose down -v       # Stop + wipe database
```

### Local Development

```bash
docker compose up --build -d postgres api mcp   # Backend in Docker
npm install && npm run dev                       # Frontend on localhost:3000
```

### Environment Variables

| Variable                          | Default                 | Description                              |
| --------------------------------- | ----------------------- | ---------------------------------------- |
| `SKILLNOTE_HOST`                  | `localhost`             | Host IP or domain (CORS + frontend URL)  |
| `SKILLNOTE_API_PORT`              | `8082`                  | Host port for the API                    |
| `SKILLNOTE_MCP_PORT`              | `8083`                  | Host port for the MCP server             |
| `SKILLNOTE_DATABASE_URL`          | *(set in compose)*      | PostgreSQL connection string             |
| `SKILLNOTE_BUNDLE_STORAGE_DIR`    | `/app/data/bundles`     | Where versioned ZIP bundles are stored   |
| `SKILLNOTE_MAX_BUNDLE_SIZE_BYTES` | `5242880`               | Max bundle upload size (5 MB)            |
| `SKILLNOTE_CORS_ORIGINS`          | *(auto from host)*      | Comma-separated CORS origins             |
| `NEXT_PUBLIC_API_BASE_URL`        | `http://localhost:8082` | Frontend API endpoint                    |
| `SKILLNOTE_MCP_FILTER_COLLECTIONS`| *(all)*                 | Comma-separated collections to expose via MCP |
| `SKILLNOTE_API_URL`               | *(auto)*                | Override API URL for MCP skill content   |
| `SKILLNOTE_WEB_URL`               | *(auto)*                | Override web URL for MCP skill content   |
| `SKILLNOTE_MCP_URL`               | *(auto)*                | Override MCP URL for setup script        |

---

## Tech Stack

| Layer      | Technology                                              |
| ---------- | ------------------------------------------------------- |
| Frontend   | Next.js 16, React 19, TypeScript, Tailwind CSS 4, Tiptap |
| Backend    | Python 3.12, FastAPI, SQLAlchemy 2, Alembic, Pydantic 2 |
| MCP Server | Python 3.12, FastMCP                                    |
| Plugin     | Bash, Python, Claude Code Plugin API                    |
| Database   | PostgreSQL 16                                           |
| CLI        | Node.js, TypeScript, Commander.js                       |
| Infra      | Docker, Docker Compose                                  |

---

## References

- [Claude Code Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) — Anthropic's official skills documentation
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins-reference) — Plugin system reference
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks) — Hook events and configuration
- [Model Context Protocol](https://modelcontextprotocol.io) — MCP specification

---

## Star Us

If you find SkillNote useful, please consider giving it a star on GitHub.

<p align="center">
  <a href="https://github.com/luna-prompts/skillnote"><img src="https://img.shields.io/github/stars/luna-prompts/skillnote?style=for-the-badge&logo=github&label=Star%20on%20GitHub" alt="Star on GitHub" /></a>
</p>

---

## Contributing

Contributions are welcome! Here's how:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request

Please follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

Join us on [Discord](https://discord.gg/GazU4amU6H) to discuss ideas, get help, or just hang out.

---

## License

MIT &copy; [Luna Prompts](https://github.com/luna-prompts)

---

<p align="center">
  Made with care by <a href="https://github.com/luna-prompts"><strong>Luna Prompts</strong></a>
</p>
