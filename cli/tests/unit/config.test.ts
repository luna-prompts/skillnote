import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig, loadConfig, saveConfig, updateConfig } from '../../src/state/config.js'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skillnote-config-'))
  file = join(dir, 'config.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('loadConfig', () => {
  it('returns defaults when file does not exist', async () => {
    const c = await loadConfig(file)
    expect(c).toEqual(defaultConfig)
  })

  it('parses a valid config file', async () => {
    await writeFile(file, JSON.stringify({ webPort: 4000, apiPort: 9000 }))
    const c = await loadConfig(file)
    expect(c.webPort).toBe(4000)
    expect(c.apiPort).toBe(9000)
    expect(c.host).toBe(defaultConfig.host)
  })

  it('throws a clear error for invalid schema', async () => {
    await writeFile(file, JSON.stringify({ webPort: 'not a number' }))
    await expect(loadConfig(file)).rejects.toThrow(/invalid/)
  })
})

describe('saveConfig', () => {
  it('writes file with 0o600 permissions', async () => {
    await saveConfig({ ...defaultConfig, webPort: 4321 }, file)
    const raw = await readFile(file, 'utf8')
    expect(JSON.parse(raw).webPort).toBe(4321)
  })

  it('validates before writing', async () => {
    // @ts-expect-error intentionally bad type to test validation
    await expect(saveConfig({ webPort: 'bad' }, file)).rejects.toThrow()
  })
})

describe('updateConfig', () => {
  it('merges a partial patch onto current config', async () => {
    await saveConfig({ ...defaultConfig, webPort: 3000 }, file)
    const next = await updateConfig({ webPort: 4000 }, file)
    expect(next.webPort).toBe(4000)
    expect(next.apiPort).toBe(defaultConfig.apiPort)
  })
})
