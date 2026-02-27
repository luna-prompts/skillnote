# SkillNote

Self-hosted skills registry for AI coding agents. Create, manage, and distribute `.md` prompt files (SKILL.md) across Claude Code, Cursor, Codex, OpenClaw, OpenHands, and more.

**Stack:** Next.js 16 · React 19 · FastAPI · PostgreSQL · Docker

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) (v2+)
- [Node.js](https://nodejs.org/) 18+ (only needed for local dev or CLI)
- [Git](https://git-scm.com/)

---

## Step-by-Step Setup

### Step 1: Clone the repository

```bash
git clone https://github.com/luna-prompts/skillnote.git
cd skillnote
```

### Step 2: Start everything with Docker

```bash
docker compose up --build -d
```

This builds and starts three containers:

| Container  | Port  | What it does                                  |
| ---------- | ----- | --------------------------------------------- |
| `postgres` | 5432  | PostgreSQL database                           |
| `api`      | 8082  | FastAPI backend (auto-migrates + seeds on start) |
| `web`      | 3000  | Next.js frontend                              |

### Step 3: Verify containers are running

```bash
docker compose ps
```

You should see all three services with status `Up` or `running (healthy)`.

### Step 4: Check the API is healthy

```bash
curl http://localhost:8082/health
```

Expected output:
```json
{"status":"ok"}
```

### Step 5: Open the Web UI

Open your browser and go to:

```
http://localhost:3000
```

### Step 6: Connect the UI to the backend

The UI works offline by default (localStorage). To connect it to the real backend:

1. Click the **gear icon** in the left sidebar to open **Settings**
2. Under **Backend Configuration**, fill in:
   - **API URL:** `http://localhost:8082`
   - **Access Token:** `skn_dev_demo_token`
3. Click **Test Connection**
4. You should see a green **"Connected"** status
5. Click **Save** — the page will reload and sync skills from the backend

> **Where does `http://localhost:8082` come from?**
> That's the API port defined in `docker-compose.yml`. The backend container runs internally on port 8080 and is mapped to host port 8082. You can change it with `SKILLNOTE_API_PORT=9000 docker compose up --build -d`.

> **Where does `skn_dev_demo_token` come from?**
> The backend seed script (`scripts/seed_data.py`) creates this dev-only token on first start. In production, generate proper tokens via the API.

### Step 7: Create your first skill

1. Press **N** on your keyboard (or click **New Skill** button)
2. A full-page editor opens (Notion-style)
3. Type a **skill name** — lowercase, hyphens allowed (e.g., `pdf-extractor`)
4. Write a **description** — explain what it does AND when to use it
5. Write the skill content in the editor below (supports rich text, code blocks, markdown)
6. Click **Create Skill**

You're done! The skill is saved to the backend and visible in the skill list.

---

## Stopping & Resetting

```bash
# Stop all containers (keeps data)
docker compose down

# Stop and wipe all data (database, volumes)
docker compose down -v

# Restart
docker compose up -d
```

---

## Local Development (without Docker for frontend)

If you want hot-reload on the frontend while the backend runs in Docker:

### Terminal 1 — Start backend

```bash
docker compose up --build -d postgres api
```

Wait for the API to be healthy:

```bash
curl http://localhost:8082/health
# {"status":"ok"}
```

### Terminal 2 — Start frontend dev server

```bash
npm install
npm run dev
```

Open http://localhost:3000 — changes to `src/` hot-reload instantly.

### Frontend commands

```bash
npm run dev    # dev server with hot-reload (http://localhost:3000)
npm run build  # production build
npm run start  # serve production build
npm run lint   # run ESLint
```

### Backend commands (with Make)

```bash
cd backend
make up        # start api + postgres
make down      # stop containers
make reset     # stop + wipe database volumes
make migrate   # run Alembic migrations
make seed      # seed dev token + sample data
make smoke     # run smoke test
```

### Backend commands (without Make)

```bash
cd backend
docker compose up --build -d
docker compose exec -T api python scripts/wait_for_db.py
docker compose exec -T api alembic upgrade head
docker compose exec -T api python scripts/seed_data.py
```

---

## CLI

SkillNote includes a CLI for installing and managing skills from the terminal — no browser needed.

### Step 1: Build the CLI

```bash
cd cli
npm install
npm run build
```

### Step 2: Make it available

**Option A — Global install (recommended):**

```bash
npm link
```

Now `skillnote` works from any directory:

```bash
skillnote --version
# 0.1.0
```

**Option B — Run directly (no global install):**

```bash
node dist/index.js --version
```

### Step 3: Login to your registry

```bash
skillnote login --host http://localhost:8082 --token skn_dev_demo_token
```

This saves credentials to `~/.skillnote/config.json`.

> **Where does the host URL come from?** Same API URL from Step 6 above — `http://localhost:8082` (or wherever your backend is running).

### Step 4: Use the CLI

```bash
# List all skills in the registry
skillnote list

# Install a skill (auto-detects your AI agent)
skillnote add pdf-extractor

# Install for a specific agent
skillnote add pdf-extractor --agent claude

# Install ALL skills at once
skillnote add --all

# Check which installed skills have updates
skillnote check

# Update all installed skills
skillnote update --all

# Remove a skill
skillnote remove pdf-extractor

# Diagnose setup issues
skillnote doctor
```

### Where does the CLI install skills?

The CLI auto-detects your AI coding agent and places `SKILL.md` files in the right directory:

| Agent       | Installs to                              |
| ----------- | ---------------------------------------- |
| Claude Code | `~/.claude/skills/<skill-name>/SKILL.md` |
| Cursor      | `.cursor/skills/<skill-name>/SKILL.md`   |
| Codex       | `.codex/skills/<skill-name>/SKILL.md`    |
| OpenClaw    | `~/.openclaw/skills/<skill-name>/SKILL.md` |
| OpenHands   | `~/.openhands/skills/<skill-name>/SKILL.md` |
| Universal   | `.skills/<skill-name>/SKILL.md`          |

Override with `--agent <name>` if auto-detection picks the wrong one.

---

## SKILL.md Format

Every skill is a Markdown file with YAML frontmatter:

```markdown
---
name: pdf-extractor
description: Extract text and tables from PDF files. Use whenever the user mentions PDFs, forms, or document extraction.
---

# PDF Extractor

When the user provides a PDF file or asks about PDF content:

1. Use the `pdftotext` tool to extract raw text
2. Look for tables and format them as markdown tables
3. Preserve headings and structure from the original document
```

### Validation rules

SkillNote enforces the [official SKILL.md spec](https://docs.anthropic.com/en/docs/claude-code/skills):

**Name** (`name` field):
- Required
- Lowercase letters, numbers, and hyphens only (`a-z`, `0-9`, `-`)
- Max 64 characters
- Cannot contain reserved words: `anthropic`, `claude`
- No XML-like tags (`<tag>`)

**Description** (`description` field):
- Required
- Max 1024 characters
- Should explain both **what** the skill does and **when** to use it
- No XML-like tags (`<tag>`)

> **Tip:** Be pushy in descriptions — Claude tends to under-trigger skills. Include specific keywords the user might say.

---

## Pasting raw markdown

You can paste a raw `.md` file (with frontmatter) directly into the editor. SkillNote will:

1. Detect the `---` frontmatter block
2. Auto-extract the `name` into the name field
3. Auto-extract the `description` into the description field
4. Render the body content in the WYSIWYG editor

---

## Changing the API Port

By default the API runs on port **8082**. To change it:

```bash
SKILLNOTE_API_PORT=9000 docker compose up --build -d
```

Then update the **API URL** in Settings to `http://localhost:9000`.

If using the CLI, re-login with the new host:

```bash
skillnote login --host http://localhost:9000 --token skn_dev_demo_token
```

---

## API Reference

All endpoints (except `/health`) require `Authorization: Bearer <token>`.

```bash
# Example: list all skills
curl http://localhost:8082/v1/skills \
  -H "Authorization: Bearer skn_dev_demo_token"
```

| Method   | Path                                     | Description              |
| -------- | ---------------------------------------- | ------------------------ |
| `GET`    | `/health`                                | Health check             |
| `GET`    | `/v1/skills`                             | List all skills          |
| `POST`   | `/v1/skills`                             | Create a skill           |
| `GET`    | `/v1/skills/{slug}`                      | Get skill by slug        |
| `PATCH`  | `/v1/skills/{slug}`                      | Update a skill           |
| `DELETE` | `/v1/skills/{slug}`                      | Delete a skill           |
| `GET`    | `/v1/skills/{slug}/comments`             | List comments            |
| `POST`   | `/v1/skills/{slug}/comments`             | Add a comment            |
| `PATCH`  | `/v1/skills/{slug}/comments/{id}`        | Edit a comment           |
| `DELETE` | `/v1/skills/{slug}/comments/{id}`        | Delete a comment         |
| `GET`    | `/v1/tags`                               | List all tags            |
| `PATCH`  | `/v1/tags/{name}`                        | Rename a tag             |
| `DELETE` | `/v1/tags/{name}`                        | Delete a tag             |
| `POST`   | `/auth/validate-token`                   | Validate a token         |

---

## Environment Variables

| Variable                   | Default                  | Description                                      |
| -------------------------- | ------------------------ | ------------------------------------------------ |
| `SKILLNOTE_API_PORT`       | `8082`                   | Host port for the API                            |
| `SKILLNOTE_DATABASE_URL`   | (set in docker-compose)  | PostgreSQL connection string                     |
| `NODE_ENV`                 | `production`             | Next.js environment                              |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8082`  | Default API URL (overridable in Settings UI)     |

---

## Keyboard Shortcuts

| Shortcut         | Action                  |
| ---------------- | ----------------------- |
| `N`              | New Skill               |
| `Cmd/Ctrl + K`   | Focus search            |
| `Cmd/Ctrl + S`   | Save (in editor)        |
| `Escape`         | Close / Go back         |

---

## Project Structure

```
skillnote/
├── src/                        # Next.js frontend
│   ├── app/(app)/              # App Router pages
│   │   ├── skills/new/         # New skill page (Notion-like editor)
│   │   └── skills/[slug]/      # Skill detail page
│   ├── components/             # React components (Shadcn UI + Tiptap)
│   └── lib/                    # API client, store, validation, utilities
├── backend/                    # FastAPI backend
│   ├── app/api/                # Route handlers
│   ├── app/db/models/          # SQLAlchemy ORM models
│   ├── app/schemas/            # Pydantic schemas with validation
│   ├── app/validators/         # SKILL.md spec validators
│   └── alembic/versions/       # DB migrations
├── cli/                        # CLI tool (Commander.js)
│   └── src/
│       ├── commands/           # login, list, add, check, update, remove, doctor
│       ├── agents/             # Agent detection + skill placement
│       └── manifest/           # SKILL.md parsing
├── docker-compose.yml          # Full stack orchestration
├── Dockerfile                  # Frontend production image (multi-stage)
└── public/                     # Static assets
```

---

## Troubleshooting

**Containers won't start:**
```bash
docker compose logs api     # check API logs
docker compose logs postgres # check DB logs
```

**API returns 401/403:**
- Check your token in Settings — it should be `skn_dev_demo_token` for dev
- Make sure the backend has been seeded: `docker compose exec -T api python scripts/seed_data.py`

**Frontend shows "Unconfigured" banner:**
- Go to Settings and configure the API URL + token (Step 6 above)

**Port already in use:**
```bash
SKILLNOTE_API_PORT=9000 docker compose up --build -d
```

**Reset everything from scratch:**
```bash
docker compose down -v
docker compose up --build -d
```

---

## License

MIT

---

[github.com/luna-prompts/skillnote](https://github.com/luna-prompts/skillnote)
