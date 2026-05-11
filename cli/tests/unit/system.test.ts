import { describe, expect, it } from 'vitest'
import {
  dockerInstallUrl,
  dockerStartHint,
  getPaths,
  getPlatform,
  isCI,
  isInteractive,
} from '../../src/lib/system.js'

describe('getPlatform', () => {
  it('returns one of the known platforms', () => {
    const p = getPlatform()
    expect(['macos', 'linux', 'windows', 'unknown']).toContain(p)
  })
})

describe('getPaths', () => {
  it('returns paths derived from the given home directory', () => {
    const p = getPaths('/Users/test')
    expect(p.root).toBe('/Users/test/.skillnote')
    expect(p.configFile).toBe('/Users/test/.skillnote/config.json')
    expect(p.stateFile).toBe('/Users/test/.skillnote/state.json')
    expect(p.lockFile).toBe('/Users/test/.skillnote/start.lock')
    expect(p.composeFile).toBe('/Users/test/.skillnote/compose/docker-compose.yml')
  })

  it('uses os.homedir() when no argument', () => {
    const p = getPaths()
    expect(p.root).toMatch(/\.skillnote$/)
  })

  it('handles home directories with spaces', () => {
    const p = getPaths('/Users/has space/test')
    expect(p.root).toBe('/Users/has space/test/.skillnote')
    expect(p.configFile).toBe('/Users/has space/test/.skillnote/config.json')
  })
})

describe('isInteractive', () => {
  it('returns a boolean', () => {
    expect(typeof isInteractive()).toBe('boolean')
  })
})

describe('isCI', () => {
  it('returns true when CI env var is set', () => {
    const original = process.env.CI
    process.env.CI = 'true'
    expect(isCI()).toBe(true)
    if (original === undefined) process.env.CI = undefined
    else process.env.CI = original
  })
})

describe('dockerStartHint', () => {
  it('has a hint for every platform', () => {
    expect(dockerStartHint.macos).toBeTruthy()
    expect(dockerStartHint.linux).toBeTruthy()
    expect(dockerStartHint.windows).toBeTruthy()
    expect(dockerStartHint.unknown).toBeTruthy()
  })

  it('exposes docker install URL', () => {
    expect(dockerInstallUrl).toMatch(/^https:\/\/docs\.docker\.com/)
  })
})
