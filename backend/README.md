# YourSkills Backend (Milestone A Scaffold)

## Includes
- FastAPI app with `/health`
- SQLAlchemy models
- Alembic initial migration
- Docker Compose (`api + postgres`)
- Seed script for 1 token + 1 skill + 1 version
- Smoke test script + DB readiness wait

## Run
```bash
cd backend
make up
```

## API Port
API is exposed on host port `${YOURSKILLS_API_PORT:-8082}` by default.

Example override:
```bash
YOURSKILLS_API_PORT=8090 docker compose up --build -d
```

## Apply migration (with DB wait)
```bash
make migrate
```

## Seed sample data
```bash
make seed
```

## Health
```bash
curl -s http://localhost:8082/health
```

## One-command smoke test
```bash
make smoke
```

## Plain Docker commands (manual)
```bash
docker compose up --build -d
docker compose exec -T api python scripts/wait_for_db.py
docker compose exec -T api alembic upgrade head
docker compose exec -T api python scripts/seed_data.py
```
