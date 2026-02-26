# SkillNote

A self-hosted skills registry for [Claude Code](https://claude.ai/claude-code) — store, browse, and manage your Claude prompt files (`.md` skills) with a web UI and REST API.

**Stack:** Next.js 16 · FastAPI · PostgreSQL · Docker

---

## Quick Start

```bash
docker compose up --build
```

That's it. Docker starts postgres, migrates the DB, seeds sample data, and runs both the API and the web UI.

| Service | URL |
|---------|-----|
| **Web UI** | http://localhost:3000 |
| **API** | http://localhost:8082 |

**First-time setup:** open the app, go to **Settings → Backend** and enter:
- **Access Token:** `skn_dev_demo_token`

Click **Test Connection** → **Save**, then reload.

---

## Development

Run the frontend with hot-reload against the Dockerised backend:

```bash
# Terminal 1 — backend
cd backend && make up && make migrate && make seed

# Terminal 2 — frontend dev server
npm install
npm run dev
```

Frontend: **http://localhost:3000** · Backend: **http://localhost:8082**

---

## Backend Commands

```bash
cd backend

make up        # start api + postgres (builds image)
make down      # stop containers
make reset     # stop containers and delete volumes (wipes DB)
make migrate   # run Alembic migrations inside the container
make seed      # seed dev token + sample data
make smoke     # run smoke test against running API
```

**Manual Docker commands (without Make):**
```bash
cd backend
docker compose up --build -d
docker compose exec -T api python scripts/wait_for_db.py
docker compose exec -T api alembic upgrade head
docker compose exec -T api python scripts/seed_data.py
```

**Override the API port:**
```bash
SKILLNOTE_API_PORT=8090 docker compose up --build -d
```

---

## Frontend Commands

```bash
npm run dev    # development server (http://localhost:3000)
npm run build  # production build
npm run start  # serve production build
npm run lint   # run ESLint
```

---

## API Reference

All endpoints require `Authorization: Bearer <token>`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/skills` | List skills |
| `POST` | `/v1/skills` | Create skill |
| `GET` | `/v1/skills/{slug}` | Get skill detail |
| `PATCH` | `/v1/skills/{slug}` | Update skill |
| `DELETE` | `/v1/skills/{slug}` | Delete skill |
| `GET` | `/v1/skills/{slug}/comments` | List comments |
| `POST` | `/v1/skills/{slug}/comments` | Add comment |
| `PATCH` | `/v1/skills/{slug}/comments/{id}` | Edit comment |
| `DELETE` | `/v1/skills/{slug}/comments/{id}` | Delete comment |
| `GET` | `/v1/tags` | List all tags with counts |
| `PATCH` | `/v1/tags/{name}` | Rename tag |
| `DELETE` | `/v1/tags/{name}` | Delete tag from all skills |
| `POST` | `/auth/validate-token` | Validate a token |
| `GET` | `/health` | Health check |

**Example:**
```bash
curl http://localhost:8082/v1/skills \
  -H "Authorization: Bearer skn_dev_demo_token"
```

---

## Environment Variables

### Backend (`backend/docker-compose.yml`)

| Variable | Default | Description |
|----------|---------|-------------|
| `SKILLNOTE_API_PORT` | `8082` | Host port for the API |
| `SKILLNOTE_TOKEN_PEPPER` | — | Secret pepper for token hashing (set in production) |
| `DATABASE_URL` | internal | PostgreSQL connection string |

### Frontend

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_BASE_URL` | Default backend URL (overridable in Settings UI) |

---

## Project Structure

```
skillnote/
├── src/
│   ├── app/(app)/          # Next.js App Router pages
│   ├── components/         # React components
│   └── lib/                # API client, store, utilities
├── backend/
│   ├── app/api/            # FastAPI route handlers
│   ├── app/db/models/      # SQLAlchemy ORM models
│   ├── app/schemas/        # Pydantic schemas
│   └── alembic/versions/   # DB migrations
├── Dockerfile              # Frontend production image
└── docker-compose.yml      # Frontend Docker Compose
```

---

## Source

[github.com/luna-prompts/skillnote](https://github.com/luna-prompts/skillnote)
