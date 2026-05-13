import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getPaths } from '../lib/system.js'

// PID-based lockfile. Prevents two `skillnote start` invocations from clashing
// on volume mounts and compose state. A stale lock (PID no longer alive) is
// auto-cleared on the next acquire attempt.

export class LockHeldError extends Error {
  readonly pid: number
  readonly startedAt: string
  constructor(pid: number, startedAt: string) {
    super(`Another skillnote process is running (pid ${pid}, started ${startedAt})`)
    this.name = 'LockHeldError'
    this.pid = pid
    this.startedAt = startedAt
  }
}

interface LockBody {
  pid: number
  startedAt: string
  version: string
}

function isAlive(pid: number): boolean {
  try {
    // kill(pid, 0) checks existence without sending a signal.
    process.kill(pid, 0)
    return true
  } catch (err) {
    // ESRCH = no such process. EPERM = exists but we can't signal it (e.g.,
    // PID 1 owned by root). Everything but ESRCH means the process is alive.
    const code = (err as NodeJS.ErrnoException).code
    return code !== 'ESRCH'
  }
}

export interface AcquireLockOptions {
  /** Override an alive-but-stale lock (e.g., a hung process). */
  force?: boolean
  /** Override the lockfile path (tests only — production uses getPaths()). */
  path?: string
}

export async function acquireLock(
  version: string,
  // Accept a plain string for the second arg to preserve the (version, path)
  // signature the unit tests have used since the original implementation —
  // saves a wholesale rewrite of the lockfile tests when adding `force`.
  pathOrOptions: string | AcquireLockOptions = {},
): Promise<() => Promise<void>> {
  const options: AcquireLockOptions =
    typeof pathOrOptions === 'string' ? { path: pathOrOptions } : pathOrOptions
  const path = options.path ?? getPaths().lockFile
  await mkdir(dirname(path), { recursive: true })

  // Check for existing lock.
  try {
    const raw = await readFile(path, 'utf8')
    const existing = JSON.parse(raw) as LockBody
    if (existing.pid && existing.pid !== process.pid && isAlive(existing.pid)) {
      if (!options.force) {
        throw new LockHeldError(existing.pid, existing.startedAt)
      }
      // R9 F26/F34: caller explicitly opted to override an alive-but-stale lock
      // (hung process holding lock for hours). The user has accepted the
      // responsibility of not killing a legitimate concurrent start.
    }
    // Stale lock — owner is dead. Continue and overwrite.
  } catch (err) {
    if (err instanceof LockHeldError) throw err
    // ENOENT or malformed — proceed to write.
  }

  const body: LockBody = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    version,
  }
  await writeFile(path, JSON.stringify(body), { mode: 0o600 })

  return async () => {
    try {
      await unlink(path)
    } catch {
      // Best-effort release; if the file vanished, that's fine.
    }
  }
}

export async function readLock(path: string = getPaths().lockFile): Promise<LockBody | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as LockBody
  } catch {
    return null
  }
}
