/**
 * Hard case #20 — API restart during web UI poll.
 *
 * When the API container restarts (e.g., during `skillnote update`), the
 * bridge's long-poll request in flight will reject — usually with
 * "fetch failed" or a connection-reset error. The loop MUST swallow this,
 * back off briefly, and continue polling once the API comes back.
 *
 * This case is fundamentally identical to "transient network blip during
 * poll", which is already covered by:
 *
 *   tests/unit/bridge.test.ts
 *     it("continues after a poll error (does not crash the loop)")
 *
 * To keep regression-safety explicit (so a future audit can map hard case
 * numbers to test files 1:1) we restate the assertion here with a fresh
 * fixture. The two tests can diverge in the future if API-restart needs a
 * different backoff strategy than a generic network blip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runBridgeLoop } from '../../src/bridge/poll.js'

const originalFetch = globalThis.fetch

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('bridge poll — API restart resilience', () => {
  it('survives a fetch rejection (API down) then continues polling once it returns', async () => {
    let pollCount = 0
    const abort = new AbortController()
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/jobs/pending')) {
        pollCount += 1
        if (pollCount === 1) {
          // First poll: API is mid-restart — connection refused.
          throw Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' })
        }
        // Second poll: API is back. Return null (no job) and abort to exit.
        abort.abort()
        return { ok: true, json: async () => null } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    await runBridgeLoop({
      apiBase: 'http://x',
      pollTimeoutSeconds: 1,
      signal: abort.signal,
    })
    // Loop kept going past the first failure → API-restart scenario survives.
    expect(pollCount).toBeGreaterThanOrEqual(2)
  })

  it('survives a second consecutive fetch rejection without crashing', async () => {
    let pollCount = 0
    const abort = new AbortController()
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/jobs/pending')) {
        pollCount += 1
        if (pollCount === 1) {
          throw new Error('fetch failed (restart 1)')
        }
        if (pollCount === 2) {
          // Second poll: abort the loop AFTER throwing, so the loop exits
          // before the 2s backoff completes (aborted sleeps resolve early).
          queueMicrotask(() => abort.abort())
          throw new Error('fetch failed (restart 2)')
        }
        // Defensive — shouldn't reach here within the abort window.
        abort.abort()
        return { ok: true, json: async () => null } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    await runBridgeLoop({
      apiBase: 'http://x',
      pollTimeoutSeconds: 1,
      signal: abort.signal,
    })
    expect(pollCount).toBeGreaterThanOrEqual(2)
  })
})
