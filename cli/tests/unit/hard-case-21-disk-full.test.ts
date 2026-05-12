/**
 * Hard case #21 — Disk full during image pull.
 *
 * When the host disk runs out of space mid-pull, Docker returns a non-zero
 * exit with stderr containing "no space left on device" or `ENOSPC`. The
 * `classify()` in src/docker/compose.ts now has a dedicated branch for
 * this so the user gets a clean "Disk full" UserFacingError with the
 * `docker system prune` remediation instead of a raw ExecaError stack.
 *
 * Fix landed in v0.5.1 (followup to #38).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UserFacingError } from '../../src/ui/errors.js'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'
import { composePull } from '../../src/docker/compose.js'

afterEach(() => {
  vi.clearAllMocks()
})

function mockExecaResult(stderr: string, exitCode = 1) {
  const fake = { exitCode, stdout: '', stderr }
  const proc = Object.assign(Promise.resolve(fake), {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  })
  vi.mocked(execa).mockReturnValueOnce(proc as unknown as ReturnType<typeof execa>)
}

describe('composePull — disk full (ENOSPC) classifier', () => {
  it('throws UserFacingError with "Disk full" header on "no space left on device"', async () => {
    mockExecaResult(
      'failed to register layer: write /var/lib/docker/overlay2/...: no space left on device',
    )
    try {
      await composePull({ composeFile: '/tmp/fake.yml' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(UserFacingError)
      const opts = (err as UserFacingError).options
      expect(opts.header).toMatch(/disk full/i)
      // Remediation must include the canonical cleanup hint.
      const remed = Array.isArray(opts.remediation)
        ? opts.remediation.join(' ')
        : opts.remediation ?? ''
      expect(remed).toMatch(/docker system prune/)
    }
  })

  it('also matches the bare ENOSPC errno string (less common but seen on some platforms)', async () => {
    mockExecaResult('ENOSPC: no space left on device, write')
    await expect(composePull({ composeFile: '/tmp/fake.yml' })).rejects.toBeInstanceOf(
      UserFacingError,
    )
  })
})
