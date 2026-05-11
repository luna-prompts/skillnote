/**
 * Hard case #16 — Docker Desktop in the "starting" state.
 *
 * When Docker Desktop is in the middle of booting, `docker version` succeeds
 * (exit 0) but returns an EMPTY string for the server version, because the
 * server hasn't accepted any clients yet. Our isDockerRunning() looks at
 *
 *   if (result.exitCode === 0 && result.stdout.trim()) { ok: true, version }
 *
 * — so an empty stdout falls through to `ok: false`. requireDocker() then
 * throws the "Docker is not running" UserFacingError with platform hints,
 * which is the right user experience for this transient state.
 *
 * If anyone refactors that condition to ignore stdout, this test will catch
 * the regression — the user would otherwise see a confusing "Docker daemon
 * (undefined)" success message followed by a compose pull that hangs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UserFacingError } from '../../src/ui/errors.js'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'
import { isDockerRunning, requireDocker } from '../../src/docker/inspect.js'

afterEach(() => {
  vi.clearAllMocks()
})

describe('Docker Desktop "starting" state (exit 0 but empty version string)', () => {
  it('isDockerRunning() returns ok=false when version string is empty', async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: '', // server up but unaccepting → empty format output
      stderr: '',
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock shape
    } as any)
    const r = await isDockerRunning()
    expect(r.ok).toBe(false)
  })

  it('isDockerRunning() returns ok=false when stdout is only whitespace', async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: '   \n  \t\n',
      stderr: '',
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock shape
    } as any)
    const r = await isDockerRunning()
    expect(r.ok).toBe(false)
  })

  it('requireDocker() throws the user-facing "Docker is not running" error', async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock shape
    } as any)
    try {
      await requireDocker()
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(UserFacingError)
      const opts = (err as UserFacingError).options
      expect(opts.header).toMatch(/Docker is not running/i)
      expect(opts.docsUrl).toMatch(/docs\.docker\.com/)
    }
  })
})
