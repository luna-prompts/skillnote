/**
 * Atomic-write tests for state/config persistence.
 *
 * Bug class addressed: a process crashing mid-write leaves a half-written
 * file. Both saveState and saveConfig now use write-then-rename so the live
 * file is never partial. These tests verify the pattern + the cleanup.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig, loadConfig, saveConfig } from '../../src/state/config.js'
import { loadState, saveState } from '../../src/state/state.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skillnote-atomic-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('saveState atomic write', () => {
  it('leaves no .tmp file after a successful write', async () => {
    const file = join(dir, 'state.json')
    await saveState({ ...(await loadState(file)), seenWelcome: true }, file)
    const entries = await readdir(dir)
    expect(entries).toContain('state.json')
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false)
  })

  // POSIX rename is atomic and overwrites; Windows rename can EPERM when
  // the destination has open handles or under concurrent rename load. Real
  // production usage of saveState is single-threaded (the start.lock
  // serializes CLI invocations), so this stress test is a developer-tier
  // assertion only — skip it on Windows where the semantics differ.
  it.skipIf(process.platform === 'win32')(
    'does not corrupt the live file when called repeatedly under load',
    async () => {
      const file = join(dir, 'state.json')
      const base = await loadState(file)
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => saveState({ ...base, totalStarts: i + 1 }, file)),
      )
      const raw = await readFile(file, 'utf8')
      expect(() => JSON.parse(raw)).not.toThrow()
    },
  )

  it('survives a pre-existing tmp file from a crashed prior process', async () => {
    const file = join(dir, 'state.json')
    // Simulate a stale .tmp from a different (dead) PID.
    await writeFile(`${file}.99999.tmp`, 'garbage from dead pid')
    await saveState({ ...(await loadState(file)), seenWelcome: true }, file)
    const reloaded = await loadState(file)
    expect(reloaded.seenWelcome).toBe(true)
  })
})

describe('saveConfig atomic write', () => {
  it('writes valid JSON that loadConfig can reread', async () => {
    const file = join(dir, 'config.json')
    await saveConfig({ ...defaultConfig, webPort: 4321 }, file)
    const reloaded = await loadConfig(file)
    expect(reloaded.webPort).toBe(4321)
  })

  it('leaves no temp files behind', async () => {
    const file = join(dir, 'config.json')
    await saveConfig({ ...defaultConfig, apiPort: 9000 }, file)
    const entries = await readdir(dir)
    expect(entries).toEqual(['config.json'])
  })
})
