import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadState, newSessionToken, saveState, updateState } from '../../src/state/state.js'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skillnote-state-'))
  file = join(dir, 'state.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('state', () => {
  it('returns defaults when file is missing', async () => {
    const s = await loadState(file)
    expect(s.seenWelcome).toBe(false)
    expect(s.totalStarts).toBe(0)
  })

  it('resets to defaults on malformed JSON rather than throwing', async () => {
    await writeFile(file, 'not json at all')
    const s = await loadState(file)
    expect(s.seenWelcome).toBe(false)
  })

  it('persists and reloads correctly', async () => {
    await saveState({ ...(await loadState(file)), seenWelcome: true, totalStarts: 5 }, file)
    const reloaded = await loadState(file)
    expect(reloaded.seenWelcome).toBe(true)
    expect(reloaded.totalStarts).toBe(5)
  })

  it('updateState merges a patch', async () => {
    await saveState({ ...(await loadState(file)) }, file)
    const next = await updateState({ pendingUpdate: '0.6.0' }, file)
    expect(next.pendingUpdate).toBe('0.6.0')
    expect(next.seenWelcome).toBe(false)
  })
})

describe('newSessionToken', () => {
  it('returns a 32-char hex string', () => {
    const t = newSessionToken()
    expect(t).toMatch(/^[a-f0-9]{32}$/)
  })

  it('generates unique tokens', () => {
    const a = newSessionToken()
    const b = newSessionToken()
    expect(a).not.toBe(b)
  })
})
