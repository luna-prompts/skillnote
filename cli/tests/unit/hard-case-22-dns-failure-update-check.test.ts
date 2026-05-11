/**
 * Hard case #22 — DNS failure on update check.
 *
 * The update check is BEST-EFFORT — laptops on planes, locked-down corp
 * networks, and broken-DNS dev VMs all blow up `getLatestVersion()` from
 * fast-npm-meta. `checkForUpdate()` must never propagate the error: the
 * worst case is the user misses a "new version available" banner. A thrown
 * exception would crash `skillnote start` and that is unacceptable.
 *
 * This test mocks fast-npm-meta to reject (DNS error) and asserts
 * checkForUpdate returns null without throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fast-npm-meta', () => ({
  getLatestVersion: vi.fn(),
}))

import { getLatestVersion } from 'fast-npm-meta'
import { checkForUpdate } from '../../src/lib/update-check.js'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('checkForUpdate — network/DNS failure resilience', () => {
  it('returns null when getLatestVersion rejects with a DNS error', async () => {
    vi.mocked(getLatestVersion).mockRejectedValueOnce(
      Object.assign(new Error('getaddrinfo ENOTFOUND registry.npmjs.org'), {
        code: 'ENOTFOUND',
      }),
    )
    const result = await checkForUpdate('skillnote', '0.5.0')
    expect(result).toBeNull()
  })

  it('returns null when getLatestVersion rejects with a generic Error', async () => {
    vi.mocked(getLatestVersion).mockRejectedValueOnce(new Error('network unreachable'))
    const result = await checkForUpdate('skillnote', '0.5.0')
    expect(result).toBeNull()
  })

  it('returns null on a timeout (does NOT bubble up)', async () => {
    // Mock a never-resolving promise so the internal withTimeout fires.
    vi.mocked(getLatestVersion).mockImplementationOnce(
      () => new Promise(() => undefined) as ReturnType<typeof getLatestVersion>,
    )
    const result = await checkForUpdate('skillnote', '0.5.0', 50 /* ms */)
    expect(result).toBeNull()
  })

  it('does not throw even when the resolved version is malformed garbage', async () => {
    // fast-npm-meta can return weird shapes on partial registry outages.
    vi.mocked(getLatestVersion).mockResolvedValueOnce(
      undefined as unknown as Awaited<ReturnType<typeof getLatestVersion>>,
    )
    const result = await checkForUpdate('skillnote', '0.5.0')
    expect(result).toBeNull()
  })
})
