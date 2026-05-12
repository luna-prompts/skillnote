import { execa } from 'execa'
import { UserFacingError } from '../ui/errors.js'

/**
 * Confirm the Docker daemon is reachable before any compose call.
 * We use `docker version --format json` rather than dockerode here because
 * (a) it works in WSL2 without socket dance, (b) it surfaces the right
 * error string for our classifier, and (c) zero extra dependency at import.
 */
export async function isDockerRunning(): Promise<{
  ok: boolean
  version?: string
  error?: string
}> {
  try {
    const result = await execa('docker', ['version', '--format', '{{.Server.Version}}'], {
      reject: false,
      timeout: 5_000,
    })
    if (result.exitCode === 0 && result.stdout.trim()) {
      return { ok: true, version: result.stdout.trim() }
    }
    return { ok: false, error: result.stderr || result.stdout || 'unknown error' }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Throws a UserFacingError if Docker isn't running, with platform-specific
 * remediation. Call this before any compose invocation.
 */
export async function requireDocker(): Promise<string> {
  const status = await isDockerRunning()
  if (!status.ok) {
    throw new UserFacingError({
      header: 'Docker is not running',
      body: 'SkillNote needs Docker to run locally (Postgres + API + Web).',
      remediation: [
        'macOS:   open -a Docker',
        'Linux:   sudo systemctl start docker',
        'Windows: Start Docker Desktop from the Start menu',
      ],
      docsUrl: 'https://docs.docker.com/get-docker/',
    })
  }
  return status.version ?? 'unknown'
}

export async function composeVersion(): Promise<string | null> {
  try {
    const result = await execa('docker', ['compose', 'version', '--short'], {
      reject: false,
      timeout: 5_000,
    })
    if (result.exitCode === 0) return result.stdout.trim()
    return null
  } catch {
    return null
  }
}

/**
 * Are there any running containers belonging to our compose project?
 *
 * Used to short-circuit the host-port pre-check on `skillnote start`: if
 * SkillNote is already up, the ports are occupied *by us*, which a TCP probe
 * can't reliably distinguish on macOS (Docker Desktop's gvproxy binds via
 * IPv6 `::` and the dual-stack mapping isn't always visible to a plain IPv4
 * probe — see #41). Asking Docker for the truth is more honest than guessing
 * from the OS networking stack.
 *
 * Returns false on any docker error: the worst case is we fall through to
 * the port check, which is the pre-existing behavior.
 */
export async function isProjectRunning(projectName = 'skillnote'): Promise<boolean> {
  try {
    const result = await execa(
      'docker',
      [
        'ps',
        '--filter',
        `label=com.docker.compose.project=${projectName}`,
        '--format',
        '{{.Names}}',
      ],
      { reject: false, timeout: 5_000 },
    )
    if (result.exitCode !== 0) return false
    return result.stdout.trim().length > 0
  } catch {
    return false
  }
}
