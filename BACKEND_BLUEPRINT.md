# SkillNote / YourSkills Backend Blueprint (v1)

## 0) Objective
Build a self-hosted backend that supports token-authenticated skill discovery and versioned bundle delivery for CLI-based installation/update.

This backend is **distribution infrastructure** (registry + metadata + bundle storage), not an agent runtime plugin.

---

## 1) Architecture (v1)

## Core Components
1. **API Service** (FastAPI recommended)
2. **PostgreSQL** (metadata + auth scopes)
3. **Object/File Storage** (zip bundles)
4. **Admin Publisher Worker/Script** (validate + package + publish)

## Deployment Modes
- **Local dev:** API + Postgres + local filesystem bundle storage
- **Self-host prod:** API + Postgres + S3-compatible storage (or mounted persistent volume)

---

## 2) Tech Stack Recommendation

## Backend
- Python 3.12+
- FastAPI + Uvicorn
- SQLAlchemy 2.x + Alembic
- Pydantic v2
- psycopg (or asyncpg)

## Security/Utility
- passlib/argon2 for token hashing
- hashlib (SHA-256)
- zipfile + strict safe extraction checks

## Infra
- Docker + docker-compose
- Optional MinIO for S3-compatible local testing

---

## 3) Repository Structure (proposed)

```text
skillnote/
  backend/
    app/
      api/
        auth.py
        skills.py
        versions.py
        downloads.py
        admin_publish.py        # optional in v1, can be internal
      core/
        config.py
        security.py
        errors.py
      db/
        base.py
        session.py
        models/
          skill.py
          skill_version.py
          access_token.py
          access_grant.py
      schemas/
        auth.py
        skill.py
        version.py
      services/
        auth_service.py
        skill_service.py
        download_service.py
        publish_service.py
        storage_service.py
      validators/
        bundle_validator.py
        frontmatter_validator.py
        zip_safety.py
      main.py
    alembic/
    tests/
      unit/
      integration/
      e2e/
    scripts/
      publish_skill.py
      seed_data.py
    Dockerfile
    docker-compose.yml
    pyproject.toml
```

---

## 4) Data Model (v1 concrete)

## `skills`
- `id` (uuid, pk)
- `name` (text, unique)
- `slug` (text, unique, indexed)
- `description` (text)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

## `skill_versions`
- `id` (uuid, pk)
- `skill_id` (fk -> skills.id, indexed)
- `version` (text semver)
- `checksum_sha256` (char(64))
- `bundle_storage_key` (text)
- `release_notes` (text nullable)
- `status` (`active|deprecated|disabled`)
- `channel` (text default `stable`)
- `published_at` (timestamptz)
- unique: (`skill_id`, `version`)

## `access_tokens`
- `id` (uuid, pk)
- `token_hash` (text unique)
- `label` (text)
- `status` (`active|revoked`)
- `subject_type` (`user|team|org`)
- `subject_id` (text)
- `expires_at` (timestamptz nullable)
- `created_at` (timestamptz)

## `token_skill_grants`
- `id` (uuid, pk)
- `token_id` (fk -> access_tokens.id, indexed)
- `skill_id` (fk -> skills.id, indexed)
- unique: (`token_id`, `skill_id`)

## Optional v1 convenience
- `audit_events` (event_type, actor, metadata jsonb, created_at)

---

## 5) API Contract (v1)

## Auth
### `POST /auth/validate-token`
Request:
```json
{ "token": "plaintext-token" }
```
Response:
```json
{
  "valid": true,
  "subject": { "type": "team", "id": "backend-eng" },
  "expiresAt": null
}
```

## Skills
### `GET /v1/skills`
Headers:
- `Authorization: Bearer <token>`

Response:
```json
[
  {
    "name": "secure-migrations",
    "slug": "secure-migrations",
    "description": "DB migration safety checklist",
    "latestVersion": "1.4.0",
    "status": "active",
    "channel": "stable"
  }
]
```

### `GET /v1/skills/{skill}/versions`
Response:
```json
[
  {
    "version": "1.4.0",
    "checksumSha256": "...",
    "status": "active",
    "channel": "stable",
    "publishedAt": "2026-02-24T12:00:00Z",
    "releaseNotes": "Added stricter SQL lint section"
  }
]
```

### `GET /v1/skills/{skill}/{version}/download`
- Returns: `application/zip`
- Include headers:
  - `X-Skill-Name`
  - `X-Skill-Version`
  - `X-Checksum-Sha256`

## Error Model
```json
{ "error": { "code": "TOKEN_INVALID", "message": "Invalid token" } }
```

Suggested codes:
- `TOKEN_INVALID`
- `TOKEN_EXPIRED`
- `SKILL_NOT_FOUND`
- `VERSION_NOT_FOUND`
- `VERSION_DISABLED`
- `FORBIDDEN`

---

## 6) Auth & Access Control Strategy

## Token Model
- Store only **hashed tokens** in DB.
- Token format (example): `ysk_live_<random>`
- Validation path:
  1. Hash incoming token
  2. Lookup active token
  3. Check expiration/status
  4. Resolve grants

## Scope for v1
- Keep it simple: **token → allowlisted skills**.
- Org/team RBAC deferred.

---

## 7) Bundle Validation & Publishing Pipeline

## Input Sources
- Local folder
- Zip file
- (Optional) git checkout path

## Validation Steps
1. Verify `SKILL.md` exists at expected root.
2. Parse YAML frontmatter.
3. Validate required frontmatter fields: `name`, `description`.
4. Enforce safe file paths (no `../`, no absolute paths).
5. Enforce max archive size + per-file limits.
6. Package deterministic zip.
7. Compute SHA-256.
8. Upload bundle and persist metadata transactionally.

## Publish Transaction Semantics
- If metadata insert fails => delete uploaded artifact.
- If artifact upload fails => rollback DB transaction.

---

## 8) Download & Integrity Flow

1. Auth token checked.
2. Confirm token has grant for skill.
3. Resolve exact version row.
4. Stream zip from storage.
5. Return checksum in response header.

CLI verifies checksum before install.

---

## 9) Security Baseline (v1)

- HTTPS required in production (warn/fail on plain HTTP except localhost/dev flag).
- Never log plaintext tokens.
- Hash tokens with strong algorithm (argon2/bcrypt + app pepper).
- Zip traversal prevention on validation and extraction.
- Strict MIME and size checks for publish endpoint/script.
- Principle of least privilege for storage credentials.

---

## 10) Reliability Guarantees

- Idempotent list/download operations.
- Publish operation atomic at metadata level.
- Deterministic error responses.
- Version rows immutable after publish (except status transitions).

---

## 11) Performance Targets & Tactics

## Targets
- `GET /v1/skills` p95 < 1s for <500 skills.
- metadata-only check path < 3s median.

## Tactics
- Indexes on token, grants, slug, skill_id/version.
- Use lightweight list queries (no blob payloads).
- Enable CDN/reverse-proxy caching for immutable bundle downloads by version.

---

## 12) Milestone Execution Plan

## Milestone A — Foundation (2–3 days)
- Bootstrap backend service + migrations + health endpoint.
- Implement DB models.
- Add docker-compose for API + Postgres.

**Exit:** service starts; migrations apply cleanly.

## Milestone B — Auth + Catalog APIs (4–6 days)
- Implement token validation and auth middleware.
- Implement `POST /auth/validate-token`, `GET /v1/skills`, `GET /v1/skills/{skill}/versions`.

**Exit:** CLI can authenticate and list authorized skills.

## Milestone C — Bundle Storage + Download (3–5 days)
- Implement storage abstraction (local filesystem first).
- Implement version download endpoint.
- Add checksum headers.

**Exit:** CLI can download versioned bundles and verify checksum.

## Milestone D — Publish Pipeline (4–6 days)
- Add validator + deterministic packager.
- Add admin publish script/API.
- Persist metadata + grants.

**Exit:** admin can publish folder/zip and users can install it.

## Milestone E — Hardening & Docs (3–4 days)
- Security tests (token leakage, zip traversal, checksum mismatch).
- Self-host docs, sample fixtures, troubleshooting.

**Exit:** reproducible self-host quickstart works from docs.

---

## 13) Test Strategy

## Unit
- frontmatter parsing
- safe path validation
- checksum generation/verification
- grant resolution logic

## Integration
- auth + access-filtered listing
- publish + download lifecycle
- deprecated/disabled version behavior

## E2E
- docker compose up
- publish sample skill
- validate-token -> list -> versions -> download

---

## 14) Open Decisions (recommendations)

1. **Publish interface for v1:** Start with admin CLI/script + optional protected API endpoint.
2. **OS matrix:** Linux + macOS as primary; Windows support validated at CLI side.
3. **Default install mode (CLI impact):** `copy` default (safer cross-platform), symlink optional.
4. **Access model:** token-to-skill allowlist in v1; RBAC in v1.5.
5. **Interoperability endpoint:** defer `/.well-known/skills/index.json` to v1.1 unless partner requires it.

---

## 15) Definition of Done (Backend v1)

- Token auth implemented with hashed storage.
- Authorized skill listing and version listing live.
- Versioned bundle download endpoint stable.
- Checksum persisted and returned for every downloadable bundle.
- Publish pipeline validates and persists versioned bundles.
- Docker Compose self-host docs verified end-to-end.
- Security and integration test suite passing.

---

## 16) Immediate Next Step (execution-ready)

Start Milestone A with this exact order:
1. Create `backend/` scaffold + FastAPI app.
2. Add SQLAlchemy models + Alembic initial migration.
3. Add `docker-compose.yml` for `api + postgres`.
4. Seed one token, one skill, one version.
5. Implement `POST /auth/validate-token` and `GET /v1/skills` first.

This gives us a real backend slice quickly and unblocks CLI integration early.
