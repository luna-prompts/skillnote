# YourSkills Backend (Milestone A Scaffold)

## Includes
- FastAPI app with `/health`
- SQLAlchemy models
- Alembic initial migration
- Docker Compose (`api + postgres`)
- Seed script for 1 token + 1 skill + 1 version

## Run
```bash
cd backend
docker compose up --build -d
```

## Apply migration
```bash
docker compose exec api alembic upgrade head
```

## Seed sample data
```bash
docker compose exec api python scripts/seed_data.py
```

## Health
```bash
docker compose exec api python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8080/health').read().decode())"
```
