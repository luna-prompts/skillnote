import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
  // Normalize separators so the same assertion works on POSIX and Windows.
  const norm = (p: string) => p.replaceAll('\\', '/')

  it('returns paths derived from the given home directory', () => {
    const p = getPaths('/Users/test')
    expect(norm(p.root)).toBe('/Users/test/.skillnote')
    expect(norm(p.configFile)).toBe('/Users/test/.skillnote/config.json')
    expect(norm(p.stateFile)).toBe('/Users/test/.skillnote/state.json')
    expect(norm(p.lockFile)).toBe('/Users/test/.skillnote/start.lock')
    expect(norm(p.composeFile)).toBe('/Users/test/.skillnote/compose/docker-compose.yml')
  })

  it('uses os.homedir() when no argument', () => {
    const p = getPaths()
    expect(p.root).toMatch(/\.skillnote$/)
  })

  it('handles home directories with spaces', () => {
    const p = getPaths('/Users/has space/test')
    expect(norm(p.root)).toBe('/Users/has space/test/.skillnote')
    expect(norm(p.configFile)).toBe('/Users/has space/test/.skillnote/config.json')
  })
})

describe('isInteractive', () => {
  it('returns a boolean', () => {
    expect(typeof isInteractive()).toBe('boolean')
  })
})

describe('isCI', () => {
  const ciEnvVars = [
    'CI',
    'CONTINUOUS_INTEGRATION',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'CIRCLECI',
    'BUILDKITE',
  ] as const
  const originals = new Map(ciEnvVars.map((key) => [key, process.env[key]]))

  beforeEach(() => {
    for (const key of ciEnvVars) delete process.env[key]
  })

  afterEach(() => {
    for (const key of ciEnvVars) {
      const value = originals.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('test_isCI_returns_false_without_ci_environment', () => {
    expect(isCI()).toBe(false)
  })

  it.each(ciEnvVars)('test_isCI_detects_%s', (key) => {
    process.env[key] = 'true'
    expect(isCI()).toBe(true)
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
