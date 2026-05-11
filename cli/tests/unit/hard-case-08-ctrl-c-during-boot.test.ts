/**
 * Hard case #8 — Ctrl+C during boot leaves no half-state.
 *
 * `installSignalHandlers` in src/commands/start.ts wires SIGINT/SIGTERM/SIGHUP
 * to a `release()` callback so the lockfile (and any other resources held by
 * `acquireLock`) get cleaned up before the process exits.
 *
 * Because `installSignalHandlers` is not exported, this test verifies the
 * BEHAVIOR through the surface that IS exported: `acquireLock` followed by
 * the lock-file disappearing once `release()` is called. The cleanup path
 * called from the signal handler is identical to the cleanup path called from
 * the normal `finally` block — same `release()` function — so verifying that
 * release() removes the lock is what makes "signal cleanup" verifiable here.
 *
 * The full integration (actually delivering SIGINT to a child process during
 * boot) is documented in tests/integration; here we pin the unit guarantee.
 */
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquireLock, readLock } from '../../src/state/lockfile.js'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skillnote-sigcleanup-'))
  file = join(dir, 'start.lock')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('signal cleanup path (release() removes the lockfile)', () => {
  it('release() leaves no lockfile on disk', async () => {
    const release = await acquireLock('1.0.0', file)
    expect(await readLock(file)).not.toBeNull()
    await release()
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('release() is idempotent — calling it twice does not throw', async () => {
    const release = await acquireLock('1.0.0', file)
    await release()
    await expect(release()).resolves.toBeUndefined()
  })

  it('release() after the lock was independently deleted still does not throw', async () => {
    const release = await acquireLock('1.0.0', file)
    // Simulate a rogue `rm` between acquire and release.
    await rm(file)
    await expect(release()).resolves.toBeUndefined()
  })
})
