# SkillNote production docker-compose, bundled with the `skillnote` npm package.
# Image tags are substituted to match the CLI version at build time.
# Users never see or edit this file; it's extracted to ~/.skillnote/compose/ on first run.

name: skillnote

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: skillnote
      POSTGRES_USER: skillnote
      POSTGRES_PASSWORD: skillnote
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U skillnote"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  api:
    image: ghcr.io/luna-prompts/skillnote-api:__VERSION__
    environment:
      SKILLNOTE_DATABASE_URL: postgresql+psycopg://skillnote:skillnote@postgres:5432/skillnote
      SKILLNOTE_BUNDLE_STORAGE_DIR: /app/data/bundles
      SKILLNOTE_CORS_ORIGINS: "http://${SKILLNOTE_HOST:-localhost}:${SKILLNOTE_WEB_PORT:-3000},http://localhost:${SKILLNOTE_WEB_PORT:-3000},http://127.0.0.1:${SKILLNOTE_WEB_PORT:-3000}"
    ports:
      - "${SKILLNOTE_API_PORT:-8082}:8080"
    volumes:
      - bundles:/app/data/bundles
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8080/health')\""]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 60s
    command: >
      sh -c "python scripts/wait_for_db.py &&
             alembic upgrade head &&
             python scripts/seed_data.py &&
             uvicorn app.main:app --host 0.0.0.0 --port 8080"
    restart: unless-stopped

  web:
    image: ghcr.io/luna-prompts/skillnote-web:__VERSION__
    ports:
      - "${SKILLNOTE_WEB_PORT:-3000}:3000"
    environment:
      NODE_ENV: production
      NEXT_PUBLIC_API_BASE_URL: "http://${SKILLNOTE_HOST:-localhost}:${SKILLNOTE_API_PORT:-8082}"
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped

volumes:
  pgdata:
  bundles:
