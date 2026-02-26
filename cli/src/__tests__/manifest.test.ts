import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('manifest', () => {
  it('returns empty manifest when none exists', async () => {
    const { loadManifest } = await import('../manifest/index.js')
    const m = loadManifest(tmpDir)
    expect(m.skills).toEqual({})
  })

  it('saves and loads a skill entry', async () => {
    const { loadManifest, saveManifest } = await import('../manifest/index.js')
    const manifest = loadManifest(tmpDir)
    manifest.skills['secure-migrations'] = {
      version: '0.1.0',
      checksum: 'abc123',
      installedAt: '2026-02-26T00:00:00Z',
      agents: ['claude', 'openclaw'],
    }
    saveManifest(tmpDir, manifest)

    const loaded = loadManifest(tmpDir)
    expect(loaded.skills['secure-migrations'].version).toBe('0.1.0')
    expect(loaded.skills['secure-migrations'].agents).toEqual(['claude', 'openclaw'])
  })

  it('removes a skill entry', async () => {
    const { loadManifest, saveManifest } = await import('../manifest/index.js')
    const manifest = loadManifest(tmpDir)
    manifest.skills['test-skill'] = {
      version: '1.0.0',
      checksum: 'def456',
      installedAt: '2026-02-26T00:00:00Z',
      agents: ['cursor'],
    }
    saveManifest(tmpDir, manifest)
    delete manifest.skills['test-skill']
    saveManifest(tmpDir, manifest)

    const loaded = loadManifest(tmpDir)
    expect(loaded.skills['test-skill']).toBeUndefined()
  })
})
