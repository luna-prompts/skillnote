/**
 * Round 3: bridge daemon must NOT hang forever if the long-poll never
 * resolves. Without the client-side timeout added in CLI #1, a slow/dead
 * upstream would freeze the daemon for the entire process lifetime.
 *
 * Verifies the AbortController-with-setTimeout pattern in pollNext.
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

describe('bridge poll — client-side timeout', () => {
  it('aborts a never-resolving fetch instead of hanging the daemon', async () => {
    const abort = new AbortController()
    let abortedFetches = 0

    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // Listen for the local abort signal that pollNext should wire up.
          init?.signal?.addEventListener('abort', () => {
            abortedFetches += 1
            // After the first abort, also abort the outer loop so the
            // test terminates.
            abort.abort()
            reject(new DOMException('aborted', 'AbortError'))
          })
          // Otherwise never resolve — simulates a hung server.
        }),
    )

    // pollTimeoutSeconds=1 → client-side ceiling = 1+5 = 6s. Use a generous
    // outer timeout so the test isn't the bottleneck if abort takes a
    // moment to propagate.
    await runBridgeLoop({
      apiBase: 'http://x',
      pollTimeoutSeconds: 1,
      signal: abort.signal,
    })

    expect(abortedFetches).toBeGreaterThanOrEqual(1)
  }, 20_000)
})
