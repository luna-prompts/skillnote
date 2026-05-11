/**
 * Hard case 26 — bundle baked into Docker image.
 *
 * Real bug found in Round 1 audit: backend/Dockerfile previously copied
 * only the backend/ tree, so the published API image didn't include
 * plugin-openclaw/ or plugin/. The /v1/openclaw-bundle.zip endpoint then
 * served a 22-byte empty zip and `skillnote connect openclaw` failed at
 * the unzip step.
 *
 * Fix: backend/Dockerfile now expects repo-root build context and
 * explicitly `COPY plugin-openclaw /openclaw` and `COPY plugin /plugin`.
 * This regression test asserts those COPY lines stay in the Dockerfile.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const DOCKERFILE_PATH = join(REPO_ROOT, 'backend', 'Dockerfile')
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'docker-images.yml')

describe('hard-case 26: bundle baked into API image', () => {
  it('backend/Dockerfile copies plugin-openclaw into /openclaw', () => {
    const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf8')
    expect(dockerfile).toMatch(/COPY\s+plugin-openclaw\s+\/openclaw/)
  })

  it('backend/Dockerfile copies plugin into /plugin', () => {
    const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf8')
    expect(dockerfile).toMatch(/COPY\s+plugin\s+\/plugin/)
  })

  it('backend/Dockerfile copies backend source explicitly (not bare COPY . /app)', () => {
    const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf8')
    expect(dockerfile).toMatch(/COPY\s+backend\s+\/app/)
    // Should NOT have the unscoped catch-all that would pull random stuff.
    expect(dockerfile).not.toMatch(/^COPY\s+\.\s+\/app\s*$/m)
  })

  it('CI workflow uses repo-root context for the api image', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8')
    // Confirm the api matrix entry uses context: . (not ./backend).
    // The whole api block lives between '- name: api' and '- name: web'.
    const apiBlock = workflow.split(/-\s+name:\s+api/)[1]?.split(/-\s+name:\s+web/)[0] ?? ''
    expect(apiBlock).toMatch(/context:\s*\.\s*$/m)
    expect(apiBlock).toMatch(/dockerfile:\s*backend\/Dockerfile/)
  })
})
