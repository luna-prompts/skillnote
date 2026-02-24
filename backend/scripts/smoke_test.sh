#!/usr/bin/env bash
set -euo pipefail

echo "[0/6] reset containers + volume"
docker compose down -v || true

echo "[1/6] starting containers"
docker compose up --build -d

echo "[2/6] waiting for db"
docker compose exec -T api python scripts/wait_for_db.py

echo "[3/6] migrate"
docker compose exec -T api alembic upgrade head

echo "[4/6] seed"
docker compose exec -T api python scripts/seed_data.py

echo "[5/6] health + data check"
docker compose exec -T api python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8080/health').read().decode())"
docker compose exec -T postgres psql -U skillnote -d skillnote -c "select count(*) as skills from skills;"

echo "smoke test passed"
