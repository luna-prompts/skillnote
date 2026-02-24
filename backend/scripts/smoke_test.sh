#!/usr/bin/env bash
set -euo pipefail

echo "[1/5] starting containers"
docker compose up --build -d

echo "[2/5] waiting for db"
docker compose exec -T api python scripts/wait_for_db.py

echo "[3/5] migrate"
docker compose exec -T api alembic upgrade head

echo "[4/5] seed"
docker compose exec -T api python scripts/seed_data.py

echo "[5/5] health + data check"
docker compose exec -T api python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8080/health').read().decode())"
docker compose exec -T postgres psql -U yourskills -d yourskills -c "select count(*) as skills from skills;"

echo "smoke test passed"
