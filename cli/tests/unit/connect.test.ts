import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock execa and global fetch so we can test connect without spawning bash
// or hitting a real backend.
vi.mock('execa', () => ({ execa: vi.fn() }))

import { execa } from 'execa'
import { SUPPORTED_AGENTS, pingApi } from '../../src/commands/connect.js'

const originalFetch = globalThis.fetch

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('SUPPORTED_AGENTS', () => {
  it('exports the canonical list', () => {
    expect(SUPPORTED_AGENTS).toContain('claude-code')
    expect(SUPPORTED_AGENTS).toContain('openclaw')
  })
})

describe('pingApi', () => {
  it('returns true when /health responds 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: true })
    expect(await pingApi('http://localhost:8082')).toBe(true)
  })

  it('returns false when /health responds non-2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 })
    expect(await pingApi('http://localhost:8082')).toBe(false)
  })

  it('returns false when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('connection refused'))
    expect(await pingApi('http://localhost:8082')).toBe(false)
  })

  it('respects the timeout', async () => {
    globalThis.fetch = vi.fn().mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('aborted')), 200)
        }),
    )
    // Pass 50ms timeout to ensure it times out before the simulated network.
    expect(await pingApi('http://localhost:8082', 50)).toBe(false)
  })
})

describe('execa mock plumbing', () => {
  // Confirms the mock is wired correctly; full connect-command tests would
  // additionally mock @clack/prompts which is overkill for this layer.
  it('execa returns a stubbable value', async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock shape
    } as any)
    const r = await execa('echo', ['hi'])
    expect(r.exitCode).toBe(0)
  })
})
