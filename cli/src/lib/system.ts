import { homedir, platform } from 'node:os'
import { join } from 'node:path'

export type Platform = 'macos' | 'linux' | 'windows' | 'unknown'

export function getPlatform(): Platform {
  const p = platform()
  if (p === 'darwin') return 'macos'
  if (p === 'linux') return 'linux'
  if (p === 'win32') return 'windows'
  return 'unknown'
}

export interface SkillNotePaths {
  root: string
  configFile: string
  stateFile: string
  lockFile: string
  composeDir: string
  composeFile: string
  logsDir: string
}

export function getPaths(home: string = homedir()): SkillNotePaths {
  const root = join(home, '.skillnote')
  return {
    root,
    configFile: join(root, 'config.json'),
    stateFile: join(root, 'state.json'),
    lockFile: join(root, 'start.lock'),
    composeDir: join(root, 'compose'),
    composeFile: join(root, 'compose', 'docker-compose.yml'),
    logsDir: join(root, 'logs'),
  }
}

// True when the process is attached to a TTY for both stdin and stdout.
// Used to decide whether interactive prompts are safe.
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

export function isCI(): boolean {
  // Standard CI env vars and a few common one-offs.
  return Boolean(
    process.env.CI ||
      process.env.CONTINUOUS_INTEGRATION ||
      process.env.GITHUB_ACTIONS ||
      process.env.GITLAB_CI ||
      process.env.CIRCLECI ||
      process.env.BUILDKITE,
  )
}

// Suggested commands per platform — used in error remediation messages.
export const dockerStartHint: Record<Platform, string> = {
  macos: 'open -a Docker',
  linux: 'sudo systemctl start docker',
  windows: 'Start Docker Desktop from the Start menu',
  unknown: 'Start the Docker daemon for your platform',
}

export const dockerInstallUrl = 'https://docs.docker.com/get-docker/'
