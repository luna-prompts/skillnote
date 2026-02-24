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

echo "[6/6] milestone B API checks"
docker compose exec -T api python - <<'PY'
import json
import urllib.request

base = 'http://127.0.0.1:8080'

def post_json(path, payload):
    req = urllib.request.Request(
        f"{base}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read().decode())

status, body = post_json('/auth/validate-token', {'token': 'skn_dev_demo_token'})
assert status == 200 and body.get('valid') is True

req = urllib.request.Request(f"{base}/v1/skills", headers={"Authorization": "Bearer skn_dev_demo_token"})
with urllib.request.urlopen(req) as r:
    skills = json.loads(r.read().decode())
assert len(skills) >= 1

req = urllib.request.Request(f"{base}/v1/skills/secure-migrations/versions", headers={"Authorization": "Bearer skn_dev_demo_token"})
with urllib.request.urlopen(req) as r:
    versions = json.loads(r.read().decode())
assert len(versions) >= 1

req = urllib.request.Request(f"{base}/v1/skills/secure-migrations/0.1.0/download", headers={"Authorization": "Bearer skn_dev_demo_token"})
with urllib.request.urlopen(req) as r:
    payload = r.read()
    assert r.status == 200
    assert r.headers.get("Content-Type", "").startswith("application/zip")
    assert r.headers.get("X-Checksum-Sha256")
    assert len(payload) > 0

print('milestone B+C checks passed')
PY

echo "smoke test passed"
