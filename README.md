<p align="center">
  <img src="public/logo.svg" width="80" height="80" alt="SkillNote" />
</p>

<h1 align="center">SkillNote</h1>

<p align="center">
  <strong>The open-source skill registry for AI coding agents.</strong>
  <br />
  Create, manage, and share <code>SKILL.md</code> files — then connect any AI agent via MCP.
</p>

<p align="center">
  <a href="https://github.com/luna-prompts/skillnote/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  <a href="https://github.com/luna-prompts/skillnote"><img src="https://img.shields.io/github/stars/luna-prompts/skillnote?style=social" alt="Stars" /></a>
  <img src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker Ready" />
  <img src="https://img.shields.io/badge/self--hosted-yes-green" alt="Self-hosted" />
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &nbsp;&middot;&nbsp;
  <a href="#connect-your-ai-agent">Connect Agent</a> &nbsp;&middot;&nbsp;
  <a href="#creating-skills">Creating Skills</a> &nbsp;&middot;&nbsp;
  <a href="#cli">CLI</a> &nbsp;&middot;&nbsp;
  <a href="#self-hosting">Self-Hosting</a>
</p>

<br />

---

## Why SkillNote?

AI agents like Claude Code, Cursor, and Codex learn new behaviours from `SKILL.md` files. The problem: those files live scattered across machines, drift out of sync, and can't be shared across a team.

**SkillNote is a self-hosted registry** that stores your skills in one place and exposes them to any AI agent via the **Model Context Protocol (MCP)**. No file copying. No syncing. Every agent always has the latest version.

<p align="center">
  <img src="docs/screenshots/hero-dashboard.png" width="100%" alt="SkillNote Dashboard" />
</p>

---

## Quick Start

Requires [Docker](https://docs.docker.com/get-docker/) and Docker Compose v2+.

```bash
git clone https://github.com/luna-prompts/skillnote.git
cd skillnote
docker compose up --build -d
```

Four containers spin up:

| Service      | URL                       | What it does                            |
| ------------ | ------------------------- | --------------------------------------- |
| **Web**      | http://localhost:3000     | Web UI — create and manage skills       |
| **API**      | http://localhost:8082     | REST API (auto-migrates + seeds)        |
| **MCP**      | http://localhost:8083/mcp | MCP server — your skills as agent tools |
| **Postgres** | localhost:5432            | Database                                |

Open **http://localhost:3000** to start creating skills. The MCP server is ready immediately at `http://localhost:8083/mcp`.

> On first boot, two starter skills (`skill-creator`, `secure-migrations`) are seeded automatically.

---

## Connect Your AI Agent

Point your AI agent at the MCP server and your skills become available as tools — no file installs needed. Any skill you add or edit in SkillNote is reflected instantly.

### Claude Code

```bash
claude mcp add --transport http skillnote http://localhost:8083/mcp --scope user
```

Restart Claude Code, then run `/mcp` to confirm `skillnote` appears. Your skills show up as callable tools.

> On a remote server? Replace `localhost` with your machine's IP or hostname.

### Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "skillnote": {
      "url": "http://localhost:8083/mcp"
    }
  }
}
```

Restart Cursor. Skills appear in the agent tools panel.

### OpenClaw

```bash
openclaw mcp add --transport http skillnote http://localhost:8083/mcp --scope user
```

### Windsurf

Add to `~/.windsurf/mcp.json`:

```json
{
  "mcpServers": {
    "skillnote": {
      "url": "http://localhost:8083/mcp"
    }
  }
}
```

### Any MCP-compatible agent

The MCP endpoint is a standard HTTP MCP server:

```
http://localhost:8083/mcp
```

Any agent that supports MCP over HTTP can connect to it directly.

---

## Creating Skills

A skill is a Markdown file with a YAML frontmatter header:

```markdown
---
name: pdf-extractor
description: Extract text and tables from PDF files. Use when the user mentions PDFs, scanned documents, or needs to parse a form.
---

# PDF Extractor

When the user provides a PDF file:

1. Use `pdftotext` to extract raw text
2. Identify tables and format them as markdown
3. Preserve headings and document structure
```

### Rules

| Field         | Rule                                                                                   |
| ------------- | -------------------------------------------------------------------------------------- |
| `name`        | Lowercase `a-z`, `0-9`, `-` only. Max 64 chars.                                       |
| `description` | Max 1024 chars. Describe **what** it does **and when** to use it. This is the trigger. |

> **Tip:** The description is how the AI decides whether to use a skill. Be specific — include phrases the user might actually say.

### Ways to create a skill

**Web UI** — Go to `http://localhost:3000` → New Skill. Paste a raw `SKILL.md` and the editor auto-extracts the frontmatter.

**API**
```bash
curl -X POST http://localhost:8082/v1/skills \
  -H "Content-Type: application/json" \
  -d '{
    "name": "pdf-extractor",
    "slug": "pdf-extractor",
    "description": "Extract text from PDF files...",
    "content_md": "# PDF Extractor\n\n..."
  }'
```

**CLI**
```bash
skillnote add pdf-extractor
```

Skills appear in the MCP server immediately — no restart required.

---

## CLI

Install and manage skills from the terminal.

```bash
cd cli && npm install && npm run build && npm link

skillnote login --host http://localhost:8082 --token skn_dev_demo_token

skillnote list                              # List all skills
skillnote add pdf-extractor                 # Install a skill (auto-detects agent)
skillnote add pdf-extractor --agent claude  # Install for a specific agent
skillnote add --all                         # Install everything
skillnote update --all                      # Update all installed skills
skillnote remove pdf-extractor              # Uninstall
skillnote doctor                            # Diagnose setup issues
```

---

## Self-Hosting

### Run on a different host or port

```bash
SKILLNOTE_HOST=192.168.1.100 docker compose up --build -d
```

Then connect agents using your machine's IP:
```bash
claude mcp add --transport http skillnote http://192.168.1.100:8083/mcp --scope user
```

### Stop / reset

```bash
docker compose down        # Stop (keeps data)
docker compose down -v     # Stop + wipe database
```

### Environment variables

| Variable               | Default            | Description                        |
| ---------------------- | ------------------ | ---------------------------------- |
| `SKILLNOTE_HOST`       | `localhost`        | Host IP/domain for CORS and URLs   |
| `SKILLNOTE_API_PORT`   | `8082`             | API port                           |
| `SKILLNOTE_MCP_PORT`   | `8083`             | MCP server port                    |

### Local development

```bash
# Backend + DB in Docker
docker compose up --build -d postgres api mcp

# Frontend with hot-reload
npm install && npm run dev   # http://localhost:3000
```

---

## Troubleshooting

<details>
<summary><strong>MCP server not showing up in my agent</strong></summary>

1. Verify the MCP server is running: `curl http://localhost:8083/mcp` should return a response
2. Check the server is healthy: `docker compose ps`
3. Restart your AI agent after adding the MCP config
4. On remote machines, make sure port `8083` is accessible

</details>

<details>
<summary><strong>Containers won't start</strong></summary>

```bash
docker compose logs api
docker compose logs mcp
docker compose logs postgres
```

</details>

<details>
<summary><strong>Port already in use</strong></summary>

```bash
SKILLNOTE_API_PORT=9000 SKILLNOTE_MCP_PORT=9001 docker compose up --build -d
```

Then update your agent's MCP URL to use the new port.

</details>

<details>
<summary><strong>Reset everything</strong></summary>

```bash
docker compose down -v && docker compose up --build -d
```

</details>

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes following [Conventional Commits](https://www.conventionalcommits.org/)
4. Open a Pull Request

---

## License

MIT &copy; [Luna Prompts](https://github.com/luna-prompts)

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/luna-prompts"><strong>Luna Prompts</strong></a>
</p>
