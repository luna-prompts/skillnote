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

echo "[6/6] API checks (no auth required)"
docker compose exec -T api python - <<'PY'
import json
import urllib.request

base = 'http://127.0.0.1:8080'

# List skills — no auth header needed
req = urllib.request.Request(f"{base}/v1/skills")
with urllib.request.urlopen(req) as r:
    skills = json.loads(r.read().decode())
assert len(skills) >= 1, f"Expected at least 1 skill, got {len(skills)}"

# Get versions for seeded skill
req = urllib.request.Request(f"{base}/v1/skills/secure-migrations/versions")
with urllib.request.urlopen(req) as r:
    versions = json.loads(r.read().decode())
assert len(versions) >= 1, f"Expected at least 1 version, got {len(versions)}"

# Download skill bundle
req = urllib.request.Request(f"{base}/v1/skills/secure-migrations/0.1.0/download")
with urllib.request.urlopen(req) as r:
    payload = r.read()
    assert r.status == 200
    assert r.headers.get("Content-Type", "").startswith("application/zip")
    assert r.headers.get("X-Checksum-Sha256")
    assert len(payload) > 0

print('API checks passed')
PY

echo "[7/7] publish check (no auth required)"
docker compose exec -T api python - <<'PY'
import io
import json
import zipfile
import urllib.request

base='http://127.0.0.1:8080'

def post_multipart(path, fields, file_field, filename, file_bytes):
    boundary = '----skillnote-boundary-123'
    body = io.BytesIO()
    for k, v in fields.items():
        body.write(f'--{boundary}\r\n'.encode())
        body.write(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode())
        body.write(str(v).encode())
        body.write(b'\r\n')
    body.write(f'--{boundary}\r\n'.encode())
    body.write(f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'.encode())
    body.write(b'Content-Type: application/zip\r\n\r\n')
    body.write(file_bytes)
    body.write(b'\r\n')
    body.write(f'--{boundary}--\r\n'.encode())

    req = urllib.request.Request(
        f"{base}{path}",
        data=body.getvalue(),
        method='POST',
        headers={
            'Content-Type': f'multipart/form-data; boundary={boundary}',
        },
    )
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read().decode())

buff = io.BytesIO()
with zipfile.ZipFile(buff, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    zf.writestr('SKILL.md', '---\nname: api-reviewer\ndescription: API review checklist\n---\n\n# API Reviewer')

status, body = post_multipart(
    '/v1/publish',
    fields={'version': '0.1.0', 'release_notes': 'seed publish from smoke'},
    file_field='bundle',
    filename='api-reviewer.zip',
    file_bytes=buff.getvalue(),
)
assert status == 200
assert body.get('skill') == 'api-reviewer'

# Verify the published skill appears in the list
req = urllib.request.Request(f"{base}/v1/skills")
with urllib.request.urlopen(req) as r:
    skills = json.loads(r.read().decode())
assert any(s.get('slug') == 'api-reviewer' for s in skills)

print('publish check passed')
PY

echo "smoke test passed"
