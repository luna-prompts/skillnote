import { afterEach, describe, expect, it, vi } from 'vitest'
import { UserFacingError } from '../../src/ui/errors.js'

// Mock execa so we can simulate Docker-up and Docker-down states.
vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'
import { isDockerRunning, requireDocker } from '../../src/docker/inspect.js'

afterEach(() => {
  vi.clearAllMocks()
})

describe('isDockerRunning', () => {
  it('returns ok=true when daemon responds', async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: '28.0.1\n',
      stderr: '',
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock shape
    } as any)
    const r = await isDockerRunning()
    expect(r.ok).toBe(true)
    expect(r.version).toBe('28.0.1')
  })

  it('returns ok=false when docker exits non-zero', async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.',
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock shape
    } as any)
    const r = await isDockerRunning()
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Cannot connect to the Docker daemon')
  })

  it('returns ok=false when docker binary is missing entirely', async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error('command not found: docker'))
    const r = await isDockerRunning()
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/command not found/)
  })
})

describe('requireDocker', () => {
  it('returns the docker version when running', async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: '28.0.1',
      stderr: '',
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock shape
    } as any)
    await expect(requireDocker()).resolves.toBe('28.0.1')
  })

  it('throws UserFacingError with remediation when docker is down', async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'Cannot connect to the Docker daemon',
      // biome-ignore lint/suspicious/noExplicitAny: minimal mock shape
    } as any)
    try {
      await requireDocker()
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(UserFacingError)
      const opts = (err as UserFacingError).options
      expect(opts.header).toMatch(/Docker is not running/)
      expect(opts.remediation).toBeTruthy()
      expect(opts.docsUrl).toMatch(/docs\.docker\.com/)
    }
  })
})
