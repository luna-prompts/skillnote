/**
 * Hard case #3 — Docker pull network interruption.
 *
 * The compose-pull subprocess can fail transiently (DNS blip, registry 5xx,
 * laptop went to sleep mid-pull). Our `classify()` in src/docker/compose.ts
 * maps several known stderr patterns onto a user-facing error with actionable
 * remediation. This test pins down those mappings so a future refactor that
 * accidentally drops a branch fails loudly.
 *
 * The classifier path is exercised through `composePull`, which is the only
 * exported function that invokes it. We mock `execa` to simulate non-zero
 * exits with the canonical Docker error strings.
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

// Helper: build the shape that execa-with-reject:false returns. We expose a
// stdout/stderr 'on' attachable EventEmitter-ish so composePull's stream wiring
// doesn't blow up.
function mockExecaResult(stderr: string, exitCode = 1) {
  const fake = {
    exitCode,
    stdout: '',
    stderr,
    // Promise resolves to this same object; before that, callers attach
    // listeners to .stdout and .stderr — give them inert objects with `on`.
  }
  // Mimic execa's child-process-like promise shape.
  const proc = Object.assign(Promise.resolve(fake), {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  })
  vi.mocked(execa).mockReturnValueOnce(proc as unknown as ReturnType<typeof execa>)
}

describe('composePull (classifier branches)', () => {
  it('classifies "manifest unknown" as UserFacingError with image-not-found header', async () => {
    mockExecaResult(
      'failed to solve: ghcr.io/luna-prompts/skillnote-api:0.5.0: not found: manifest unknown',
    )
    try {
      await composePull({ composeFile: '/tmp/fake.yml' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(UserFacingError)
      const opts = (err as UserFacingError).options
      expect(opts.header).toMatch(/SkillNote image not found/i)
      expect(opts.remediation).toBeTruthy()
    }
  })

  it('classifies "Cannot connect to the Docker daemon" as Docker-down error', async () => {
    mockExecaResult(
      'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
    )
    try {
      await composePull({ composeFile: '/tmp/fake.yml' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(UserFacingError)
      const opts = (err as UserFacingError).options
      expect(opts.header).toMatch(/Docker is not running/i)
      expect(opts.docsUrl).toMatch(/docs\.docker\.com/)
    }
  })

  it('classifies "403 Forbidden" as registry-auth error with --no-pull hint', async () => {
    mockExecaResult(
      'Error response from daemon: Head "https://ghcr.io/v2/luna-prompts/skillnote-api/manifests/0.5.0": denied: 403 Forbidden',
    )
    try {
      await composePull({ composeFile: '/tmp/fake.yml' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(UserFacingError)
      const opts = (err as UserFacingError).options
      expect(opts.header).toMatch(/Could not pull/i)
      const remediationText = Array.isArray(opts.remediation)
        ? opts.remediation.join(' ')
        : (opts.remediation ?? '')
      expect(remediationText).toMatch(/--no-pull/)
    }
  })
})
