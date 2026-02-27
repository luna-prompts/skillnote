import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillnote-test-'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('config', () => {
  it('returns null when no config exists', async () => {
    const { loadConfig } = await import('../config/index.js')
    const cfg = loadConfig(path.join(tmpDir, '.skillnote'))
    expect(cfg).toBeNull()
  })

  it('saves and loads config', async () => {
    const { saveConfig, loadConfig } = await import('../config/index.js')
    const configDir = path.join(tmpDir, '.skillnote')
    saveConfig(configDir, { host: 'https://example.com' })
    const cfg = loadConfig(configDir)
    expect(cfg).toEqual({ host: 'https://example.com' })
  })

  it('resolves env vars over config file', async () => {
    const { resolveAuth } = await import('../config/index.js')
    vi.stubEnv('SKILLNOTE_HOST', 'https://env.example.com')
    const auth = resolveAuth(path.join(tmpDir, '.skillnote'))
    expect(auth).toEqual({ host: 'https://env.example.com' })
  })
})
