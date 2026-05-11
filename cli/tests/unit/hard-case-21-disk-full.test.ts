/**
 * Hard case #21 — Disk full during image pull.
 *
 * When the host disk runs out of space mid-pull, Docker returns a non-zero
 * exit with stderr containing "no space left on device". The CURRENT
 * `classify()` in src/docker/compose.ts has explicit branches for:
 *   - daemon down
 *   - 403 / unauthorized
 *   - manifest unknown / not found
 * but NOT for ENOSPC — so this case falls through to a generic re-throw of
 * the raw ExecaError, which produces a confusing stack trace instead of a
 * crisp "your disk is full" message.
 *
 * This test pins the CURRENT (subpar) behavior so:
 *   (a) future improvements to classify() must update this test and add the
 *       branch deliberately, not by accident;
 *   (b) the test docs (this comment) record the gap for whoever picks up
 *       the polish work.
 *
 * TODO(classifier): Add a branch in src/docker/compose.ts `classify()` that
 *   matches /no space left on device|ENOSPC/i and throws a UserFacingError:
 *     header: "Out of disk space pulling SkillNote images"
 *     remediation: ["docker system prune -a", "Free up >5GB and retry."]
 *   When that lands, update this test to expect UserFacingError instead of
 *   the raw ExecaError shape.
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

describe('composePull — disk full (ENOSPC)', () => {
  it('falls through to the generic ExecaError path today (SHOULD be a UserFacingError)', async () => {
    mockExecaResult(
      'failed to register layer: write /var/lib/docker/overlay2/...: no space left on device',
    )

    let caught: unknown
    try {
      await composePull({ composeFile: '/tmp/fake.yml' })
    } catch (err) {
      caught = err
    }

    // CURRENT BEHAVIOR (subpar): the classifier doesn't recognize ENOSPC, so
    // composePull throws the raw result-object-shaped ExecaError instead of
    // a UserFacingError. We pin that here so improvements have to be
    // deliberate (see TODO at top of file).
    expect(caught).toBeDefined()
    expect(caught).not.toBeInstanceOf(UserFacingError)
    // Sanity: the stderr containing "no space" is preserved on the rejection.
    const text = JSON.stringify(caught)
    expect(text).toMatch(/no space left on device/)
  })
})
