<p align="center">
  <img src="public/logo.svg" width="80" height="80" alt="SkillNote" />
</p>

<h1 align="center">SkillNote</h1>

<p align="center">
  <strong>The open-source skill registry for AI coding agents.</strong>
  <br />
  Create, manage, and distribute <code>SKILL.md</code> files, or connect any agent directly via MCP.
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
  <a href="#connect-your-agent">Connect</a> &nbsp;&middot;&nbsp;
  <a href="#skill-push">Skill Push</a> &nbsp;&middot;&nbsp;
  <a href="#features">Features</a> &nbsp;&middot;&nbsp;
  <a href="#self-hosting">Self-Hosting</a> &nbsp;&middot;&nbsp;
  <a href="#contributing">Contributing</a>
</p>

<br />

---

## Why SkillNote?

AI coding agents like Claude Code, Cursor, and Codex use `SKILL.md` files to learn new capabilities. But managing these files is painful:

- They live scattered across `~/.claude/skills/`, `.cursor/skills/`, `.codex/skills/`
- No versioning, no search, no way to share across projects or teams
- Writing them from scratch means guessing what works

**SkillNote fixes this.** It's a self-hosted registry with a clean web UI, a Claude Code plugin for full-feature auto-sync, an MCP server that lets any agent connect directly, and a built-in feedback loop where agents rate skills after use.

**Why self-hosted?** Enterprise workflows, proprietary codebases, and compliance-sensitive prompts contain institutional knowledge that shouldn't leave your infrastructure. SkillNote runs entirely on your machines. Your skills stay private, versioned, and accessible only to your team.

<p align="center">
  <img src="docs/screenshots/hero-dashboard.png" width="100%" alt="SkillNote Dashboard" />
</p>

---

## Skill Reviews & Ratings

SkillNote is the only skill registry with a **built-in feedback loop**. After an agent uses a skill, it rates it (1-5 stars) and optionally describes what it did — giving you real data on which skills actually work.

```
Agent uses skill  →  complete_skill(rating: 4, outcome: "built auth flow")  →  SkillNote
```

**What you get:**
- **Per-version ratings** — see how each version of a skill performs, right in the version history
- **Agent reviews** — read what agents actually did with the skill (outcome messages)
- **Analytics dashboard** — top skills, rating distribution, completion rates, and trends over time
- **Settings control** — toggle rating collection and outcome fields on/off from the Settings page

This creates a data-driven workflow: write a skill → agents use it → review the ratings → improve → repeat. Skills get better over time because you have real feedback, not guesswork.

---

## Quick Start

Make sure you have [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) v2+ installed.

```bash
git clone https://github.com/luna-prompts/skillnote.git
cd skillnote
docker compose up --build -d
```

Four containers spin up:

| Service    | URL                        | What it does                            |
| ---------- | -------------------------- | --------------------------------------- |
| **Web**    | http://localhost:3000      | Next.js frontend                        |
| **API**    | http://localhost:8082      | FastAPI backend (auto-migrates + seeds) |
| **MCP**    | http://localhost:8083/mcp  | MCP server, skills as tools             |
| **DB**     | localhost:5432             | PostgreSQL 16                           |

Open **http://localhost:3000** and start creating skills.

> The backend auto-runs migrations and seeds default skills (`skill-creator`, `skill-push`, `secure-migrations`) on first boot. No manual setup needed.

---

## Skills vs MCP: What's the Difference?

> Most people building AI agents hear about both and assume they're the same thing. They're not. Understanding the difference is what makes SkillNote click.

### Skills: reusable intelligence

A Skill is a reusable piece of knowledge injected into an agent's context: instructions, workflows, rules, examples. Think of it as a dynamic system prompt loaded on demand:

```
User message
    ↓
Agent picks the right Skill
    ↓
Injects SKILL.md content into the prompt
    ↓
LLM responds with that context
```

Skills improve **reasoning**. They teach the agent *how* to do something.

### MCP: context transport

[Model Context Protocol](https://modelcontextprotocol.io) is a standard for delivering context to agents: tools, APIs, documents, prompts. It improves **connectivity**. It doesn't care what the content is; it's the pipe.

```
Skills = HTML    (the content)
MCP    = HTTP    (the transport)
```

HTTP delivers HTML. But HTML isn't part of HTTP. Same relationship.

### How SkillNote combines both

**Version 1: local files:**
```
Agent reads skills/making-tea/SKILL.md from disk
```
Simple. Works offline. But skills go stale, drift across machines, and require manual installs.

**Version 2: MCP delivery (what SkillNote does):**
```
Agent  →  MCP  →  SkillNote  →  Skills DB
```
Every skill is exposed as an MCP tool. The agent discovers and calls them live: no files, no installs, always up to date. Update a skill in the Web UI and every connected agent gets the new version instantly.

> **Real-time push notifications.** When a skill is created, updated, or deleted the MCP server immediately pushes a `notifications/tools/list_changed` event to every connected agent over their open SSE stream. Compliant clients (Claude Code, OpenClaw, Cursor, …) re-fetch `tools/list` automatically — no reconnect, no polling, no restart required.

```
┌──────────┐     tools/list      ┌───────────────┐
│  Agent   │ ─────────────────▶  │  SkillNote    │
│          │ ◀─────────────────  │  MCP Server   │
│          │   [all your skills] │               │
│          │                     │  PostgreSQL   │
│          │  tools/call         │  LISTEN/      │
│          │ ─────────────────▶  │  NOTIFY       │
│          │ ◀─────────────────  │               │
│          │   skill content     │               │
│          │                     │               │
│          │ ◀─────────────────  │  push:        │
│          │  notifications/     │  tools/list   │
│          │  tools/list_changed │  _changed     │
└──────────┘  (SSE stream)       └───────────────┘
```

| | Local Skills | MCP Skills (SkillNote) |
|---|---|---|
| Updates | Manual (`git pull` / `npx install`) | Automatic: edit in UI, live instantly |
| Fragmentation | Different versions per machine | One source of truth |
| Discovery | Agent must know the file path | Agent discovers via `tools/list` |
| Sharing | Send files or links | Connect to the same server |
| Offline | Yes | Needs network |

---

## Connect Your Agent

### Claude Code (recommended)

```bash
curl -sf http://localhost:8082/setup | bash
```

One command. Here's what happens:

1. **Creates a Claude Code plugin** in `~/.claude/plugins/` with MCP config, sync hooks, and analytics
2. **Connects to SkillNote's MCP server** for skill ratings and fallback delivery
3. **Syncs all skills** to `~/.claude/skills/` as local `SKILL.md` files with full frontmatter
4. **Done** — start `claude` in any project, skills are there

**Every session after that:**

```
$ claude

SkillNote: 12 skills (all current)       ← automatic, on every session start

claude> help me refactor this error handling
        ← Claude auto-triggers the right skill based on its description
        ← allowed-tools, context: fork, effort — all enforced
        ← usage tracked automatically in SkillNote analytics
```

**What the plugin installs:**

| Component | What it does |
|-----------|-------------|
| **SessionStart hook** | Syncs skills from the registry to `~/.claude/skills/` with full frontmatter on every session |
| **PostToolUse hook** | Tracks every skill invocation in SkillNote analytics (async, non-blocking) |
| **MCP connection** | Connects to SkillNote for `complete_skill` ratings and `skill-push` |
| **`/skillnote:skill-push`** | Create new skills directly from conversations |
| **`/skillnote:skill-creator`** | Dedicated agent for deep skill creation (effort: high, memory: project) |
| **`skillnote-sync`** | CLI command available in Bash for manual sync (`--force` to re-sync all) |

**What works automatically (zero config):**
- `allowed-tools`, `context: fork`, `effort`, `model` — full Claude Code skill features
- **Real-time sync** — edit a skill in the web UI, local copies update within 60 seconds (background re-sync on every prompt, async, never blocks)
- Usage analytics — every skill invocation tracked
- Skill ratings — agents rate skills (1-5) after use
- Offline mode — skills persist locally, sync fails gracefully if server is down
- Context survival — skills re-sync after context compaction
- Skill deletion — remove from registry, local copy cleaned up on next sync

> **LAN setup:** Replace `localhost` with your server IP: `curl -sf http://<your-server-ip>:8082/setup | bash`

### Per-Project Scoping

By default, all skills sync globally to `~/.claude/skills/` (available in every project). To scope skills per project, add `.skillnote.json` to the project root:

```json
{"collections": ["frontend", "conventions"]}
```

Only skills in those collections will sync for that project (written to `.claude/skills/` inside the project directory).

### Advanced Metadata

The skill editor has an **Advanced Metadata** section where you can add Claude Code frontmatter:

```yaml
allowed-tools: Read Write Grep
context: fork
effort: high
```

These fields are synced into the local `SKILL.md` frontmatter by the plugin. They only take effect for locally-installed skills (not MCP-delivered ones).

### Other Agents (MCP only)

Any MCP-compatible agent can connect directly. Each skill becomes a tool the agent discovers and calls.

<details>
<summary><strong>OpenClaw / Cursor / Codex / OpenHands / Others</strong></summary>

```bash
# OpenClaw
openclaw mcp add --transport http skillnote http://localhost:8083/mcp --scope user

# Cursor — add to ~/.cursor/mcp.json
{"mcpServers": {"skillnote": {"url": "http://localhost:8083/mcp"}}}

# Any MCP-compatible agent
http://localhost:8083/mcp
```

</details>

### Filter Skills by Collection

Scope which skills each agent sees via MCP:

```bash
SKILLNOTE_MCP_FILTER_COLLECTIONS=devops,security docker compose up -d mcp
```

### MCP Integrations UI

The **Integrations** page gives you ready-to-copy config snippets for every supported agent, plugin install commands, a scope selector for collection-filtered URLs, and a live connection monitor.

<p align="center">
  <img src="docs/screenshots/mcp-integrations.png" width="100%" alt="MCP Integrations" />
</p>

---

## Skill Push

Agents can create new skills directly from conversations. When Claude notices you giving the same instruction repeatedly, it offers to save it as a reusable skill:

```
User: "use pnpm not npm"  (3rd time this session)

Claude: "I've noticed you keep correcting me about pnpm.
         Want me to create a skill for this?"

User: "yes"

Claude: → drafts the skill → shows you for review → pushes to SkillNote
        → "Done! 'use-pnpm' is live. All agents will see it next session."
```

The `skill-push` skill guides the agent through 6 steps:

1. **Confirm** the pattern with the user
2. **Draft** the skill (name, description with trigger keywords, content)
3. **Check** if the skill already exists (create new or update existing)
4. **Collections** — fetch available collections and let the user choose
5. **Review** the complete skill with the user
6. **Push** to the SkillNote API

For deeper skill creation (with eval loops, description optimization, A/B testing), use the `/skillnote:skill-creator` agent — it runs with `effort: high` and `memory: project` for cross-session learning.

Toggle skill creation on/off in **Settings > MCP Tools > Allow Agents to Create Skills**.

---

## Features

### Skill Editor
A Notion-style WYSIWYG editor powered by Tiptap. Write in rich text or switch to raw markdown. Paste a raw `SKILL.md` file and it auto-extracts the name, description, and body from the frontmatter.

<p align="center">
  <img src="docs/screenshots/skill-editor.png" width="100%" alt="Skill Editor" />
</p>

### Version History
Every save creates a snapshot. Browse the full history, compare versions, and restore any previous state with one click. Each version shows its average rating and agent reviews inline, so you can see exactly how a version performed before deciding to restore or build on it.

<p align="center">
  <img src="docs/screenshots/version-history.png" width="100%" alt="Version History" />
</p>

### Analytics
Track how your skills are used across every connected agent. The Analytics dashboard shows total calls, unique skills invoked, active agents, a skill leaderboard with ratings, agent breakdown by client, rating distribution and trends, an activity timeline, collection usage, and a live connections panel — all filterable by 7d / 30d / 90d / all-time.

<p align="center">
  <img src="docs/screenshots/analytics-dashboard.png" width="100%" alt="Analytics Dashboard" />
</p>

### Collections
Organise skills into collections. Filter, search, and browse by category. Add or remove skills from any collection with inline confirmation.

### Multi-Agent Install
Install skills as local files to any AI coding agent from the web UI or CLI. Supported agents:

| Agent       | Install Path                                |
| ----------- | ------------------------------------------- |
| Claude Code | `~/.claude/skills/<skill>/SKILL.md`         |
| Cursor      | `.cursor/skills/<skill>/SKILL.md`           |
| Codex       | `.codex/skills/<skill>/SKILL.md`            |
| OpenClaw    | `~/.openclaw/skills/<skill>/SKILL.md`       |
| OpenHands   | `~/.openhands/skills/<skill>/SKILL.md`      |
| Windsurf    | `.windsurf/skills/<skill>/SKILL.md`         |
| Universal   | `.skills/<skill>/SKILL.md`                  |

---

## SKILL.md Format

Every skill is a Markdown file with YAML frontmatter:

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

Skills synced locally via the plugin can include additional Claude Code frontmatter:

```yaml
allowed-tools: Read Write Bash(pdftotext *)
context: fork
effort: high
```

These fields are set in the editor's **Advanced Metadata** section and stored in the `extra_frontmatter` field.

---

## Self-Hosting

### System Requirements

SkillNote is lightweight. Here's what it uses on a typical machine at idle:

| Container    | Image size | RAM (idle) | RAM (under load) |
| ------------ | ---------- | ---------- | ---------------- |
| **Web**      | ~302 MB    | ~37 MB     | ~60 MB           |
| **API**      | ~456 MB    | ~71 MB     | ~120 MB          |
| **MCP**      | ~456 MB    | ~104 MB    | ~160 MB          |
| **Postgres** | ~663 MB    | ~38 MB     | ~80 MB           |
| **Total**    | ~1.9 GB    | **~250 MB**| **~420 MB**      |

> The API and MCP images share base layers — the combined pull is ~600 MB, not 912 MB.

**Minimum recommended specs:**
- CPU: 1 core (2+ recommended for MCP-heavy workloads)
- RAM: 512 MB free
- Disk: 2 GB for images + space for skill bundles (5 MB each by default)

**Disk usage over time:**
- Each published skill version creates a ZIP bundle (≤ 5 MB by default)
- PostgreSQL data grows slowly — a typical install with 100 skills is < 10 MB
- Logs are written to stdout (captured by Docker); no files accumulate on disk

To check live resource usage at any time:

```bash
docker stats
```

### Docker Compose (recommended)

```bash
git clone https://github.com/luna-prompts/skillnote.git
cd skillnote
docker compose up --build -d
```

#### Custom host or port

```bash
SKILLNOTE_HOST=<your-server-ip> SKILLNOTE_API_PORT=9000 docker compose up --build -d
```

#### Stop & reset

```bash
docker compose down          # Stop (keeps data)
docker compose down -v       # Stop + wipe database
```

### Local Development

Run the backend in Docker, frontend with hot-reload:

```bash
# Terminal 1: Backend + MCP
docker compose up --build -d postgres api mcp
curl http://localhost:8082/health   # Wait for {"status":"ok"}

# Terminal 2: Frontend
npm install
npm run dev                         # http://localhost:3000
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
| `SKILLNOTE_API_URL`               | *(auto)*                | Override API URL for MCP skill content        |
| `SKILLNOTE_WEB_URL`               | *(auto)*                | Override web URL for MCP skill content        |
| `SKILLNOTE_MCP_URL`               | *(auto)*                | Override MCP URL for setup script             |

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

- [Claude Code Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) - Anthropic's official skills documentation
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins-reference) - Plugin system reference
- [Model Context Protocol](https://modelcontextprotocol.io) - MCP specification
- [AgentSkills.io](https://agentskills.io/home) - The skills ecosystem
- [Codex Skills](https://developers.openai.com/codex/skills/) - OpenAI Codex skills reference
- [Antigravity Skills](https://antigravity.google/docs/skills) - Google Antigravity skills documentation
- [OpenHands Skills](https://docs.openhands.dev/overview/skills) - OpenHands skills overview

---

## Star Us

If you find SkillNote useful, please consider giving it a star on GitHub. It helps others discover the project and motivates us to keep improving it.

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
  Made with ❤️ by <a href="https://github.com/luna-prompts"><strong>Luna Prompts</strong></a>
</p>
