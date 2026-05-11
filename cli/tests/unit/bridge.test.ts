import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runBridgeLoop } from '../../src/bridge/poll.js'

const originalFetch = globalThis.fetch

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('runBridgeLoop', () => {
  it('exits cleanly when signal aborts before polling', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(
      runBridgeLoop({ apiBase: 'http://x', signal: abort.signal }),
    ).resolves.toBeUndefined()
  })

  it('handles a null pending response without throwing', async () => {
    let calls = 0
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      calls += 1
      if (calls >= 2) {
        // Abort after one full poll cycle so the loop exits.
        abort.abort()
      }
      return {
        ok: true,
        json: async () => null,
      } as Response
    })
    const abort = new AbortController()
    await runBridgeLoop({
      apiBase: 'http://x',
      pollTimeoutSeconds: 1,
      signal: abort.signal,
    })
    expect(calls).toBeGreaterThanOrEqual(1)
  })

  it('claims and processes an `open` job (the noop type)', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = []
    let pollCount = 0
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      captured.push({ url, init })
      // First poll returns a job; second poll triggers abort.
      if (url.includes('/jobs/pending')) {
        pollCount += 1
        if (pollCount === 1) {
          return {
            ok: true,
            json: async () => ({
              id: 'job-1',
              type: 'open',
              agent: 'noop',
              status: 'pending',
            }),
          } as Response
        }
        abort.abort()
        return { ok: true, json: async () => null } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    const abort = new AbortController()
    await runBridgeLoop({
      apiBase: 'http://x',
      pollTimeoutSeconds: 1,
      signal: abort.signal,
    })

    const claimCall = captured.find((c) => c.url.includes('/claim'))
    const doneCall = captured.find((c) => c.url.includes('/done'))
    expect(claimCall).toBeDefined()
    expect(doneCall).toBeDefined()
  })

  it('continues after a poll error (does not crash the loop)', async () => {
    let pollCount = 0
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/jobs/pending')) {
        pollCount += 1
        if (pollCount === 1) throw new Error('network blip')
        // Second poll: abort and exit.
        abort.abort()
        return { ok: true, json: async () => null } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    const abort = new AbortController()
    await runBridgeLoop({
      apiBase: 'http://x',
      pollTimeoutSeconds: 1,
      signal: abort.signal,
    })
    expect(pollCount).toBeGreaterThanOrEqual(2)
  })
})
