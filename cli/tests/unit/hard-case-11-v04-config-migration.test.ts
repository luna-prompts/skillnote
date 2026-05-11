/**
 * Hard case #11 — Existing v0.4 install (implicit config migration).
 *
 * Users upgrading from v0.4 have a `~/.skillnote/config.json` written by the
 * old CLI that does not contain the new schema fields (`webPort`, `apiPort`,
 * `browserMode`, `updateCheck`, `telemetry`). The schema declares defaults
 * for every new field, so loadConfig() should silently fill them in rather
 * than reject with "schema invalid" and ruin the user's first upgrade.
 *
 * This test seeds an OLD-format config and asserts the new fields come back
 * populated with defaults — i.e., migration is implicit and lossless.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig, loadConfig } from '../../src/state/config.js'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skillnote-v04-config-'))
  file = join(dir, 'config.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('v0.4 → v0.5 config migration (implicit)', () => {
  it('fills in defaults for all new fields when only host is present (the v0.4 shape)', async () => {
    // v0.4 config.json — just a `host` field, no ports or feature flags.
    await writeFile(file, JSON.stringify({ host: 'http://localhost:8082' }))
    const c = await loadConfig(file)
    expect(c.host).toBe('http://localhost:8082')
    expect(c.webPort).toBe(defaultConfig.webPort)
    expect(c.apiPort).toBe(defaultConfig.apiPort)
    expect(c.browserMode).toBe(defaultConfig.browserMode)
    expect(c.updateCheck).toBe(defaultConfig.updateCheck)
    expect(c.telemetry).toBe(defaultConfig.telemetry)
  })

  it('preserves a v0.4 LAN host (custom IP) through the migration', async () => {
    await writeFile(file, JSON.stringify({ host: 'http://192.168.1.50:8082' }))
    const c = await loadConfig(file)
    expect(c.host).toBe('http://192.168.1.50:8082')
    // And the new fields fall through to defaults.
    expect(c.webPort).toBe(3000)
    expect(c.apiPort).toBe(8082)
  })

  it('returns a fully-defaulted config when the file is missing entirely', async () => {
    // No write — file does not exist.
    const c = await loadConfig(file)
    expect(c).toEqual(defaultConfig)
  })
})
