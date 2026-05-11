/**
 * Hard case #24 — Schema migration failure on startup.
 *
 * The API container's startup `command:` field in the bundled compose file
 * runs `alembic upgrade head` BEFORE the FastAPI uvicorn server starts. This
 * means:
 *   1. Fresh installs auto-bootstrap the schema (no manual `alembic upgrade`).
 *   2. Upgrades that bring schema changes auto-migrate.
 *   3. If a migration fails, the container exits before serving — which is
 *      the right behavior: a half-migrated DB serving requests would be
 *      worse than the API never coming up.
 *
 * If anyone "simplifies" the compose command and drops `alembic upgrade head`,
 * fresh installs would fail with "relation 'skills' does not exist" the
 * first time they hit the API — a brutal first-run experience. This test
 * locks the migration step in.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TPL = join(__dirname, '..', '..', 'assets', 'docker-compose.yml.tpl')

describe('docker-compose.yml.tpl — schema bootstrap on container startup', () => {
  it("api.command runs 'alembic upgrade head' before uvicorn", async () => {
    const src = await readFile(TPL, 'utf8')
    const apiSection = src.split(/^\s*api:/m)[1]?.split(/^\s*web:/m)[0] ?? ''
    expect(apiSection, 'api service block').toBeTruthy()
    expect(apiSection).toMatch(/alembic upgrade head/)
  })

  it('alembic upgrade comes BEFORE uvicorn in the command pipeline', async () => {
    const src = await readFile(TPL, 'utf8')
    const apiSection = src.split(/^\s*api:/m)[1]?.split(/^\s*web:/m)[0] ?? ''
    const alembicIdx = apiSection.indexOf('alembic upgrade head')
    const uvicornIdx = apiSection.indexOf('uvicorn')
    expect(alembicIdx).toBeGreaterThan(-1)
    expect(uvicornIdx).toBeGreaterThan(-1)
    expect(alembicIdx).toBeLessThan(uvicornIdx)
  })

  it('api.command also runs wait_for_db.py before alembic (avoids race on cold start)', async () => {
    const src = await readFile(TPL, 'utf8')
    const apiSection = src.split(/^\s*api:/m)[1]?.split(/^\s*web:/m)[0] ?? ''
    const waitIdx = apiSection.indexOf('wait_for_db.py')
    const alembicIdx = apiSection.indexOf('alembic upgrade head')
    expect(waitIdx).toBeGreaterThan(-1)
    expect(waitIdx).toBeLessThan(alembicIdx)
  })

  it('api depends_on postgres with healthy condition (ordering safety net)', async () => {
    const src = await readFile(TPL, 'utf8')
    const apiSection = src.split(/^\s*api:/m)[1]?.split(/^\s*web:/m)[0] ?? ''
    expect(apiSection).toMatch(/depends_on/)
    expect(apiSection).toMatch(/condition:\s*service_healthy/)
  })
})
