import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LockHeldError, acquireLock, readLock } from '../../src/state/lockfile.js'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skillnote-lock-'))
  file = join(dir, 'start.lock')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('lockfile', () => {
  it('acquires and releases cleanly when no prior lock exists', async () => {
    const release = await acquireLock('1.0.0', file)
    const body = await readLock(file)
    expect(body?.pid).toBe(process.pid)
    expect(body?.version).toBe('1.0.0')
    await release()
    expect(await readLock(file)).toBeNull()
  })

  // Uses PID 1 (init/launchd) to simulate a "live" non-self process. Windows
  // has no PID 1, so process.kill(1, 0) returns ESRCH and the test mode
  // doesn't apply. Coverage on POSIX exercises the path; Windows users still
  // get correct behavior — only the test stunt is platform-specific.
  it.skipIf(process.platform === 'win32')(
    'throws LockHeldError when a live process holds the lock',
    async () => {
      await writeFile(
        file,
        JSON.stringify({
          pid: 1,
          startedAt: new Date().toISOString(),
          version: '1.0.0',
        }),
      )
      await expect(acquireLock('1.0.0', file)).rejects.toThrow(LockHeldError)
    },
  )

  it('overrides a stale lock (PID dead)', async () => {
    // Pick a PID that is extremely unlikely to be alive — a max-int 32-bit value.
    const fakePid = 999_999_999
    await writeFile(
      file,
      JSON.stringify({
        pid: fakePid,
        startedAt: new Date().toISOString(),
        version: '0.0.1',
      }),
    )
    const release = await acquireLock('1.0.0', file)
    const body = await readLock(file)
    expect(body?.pid).toBe(process.pid)
    expect(body?.version).toBe('1.0.0')
    await release()
  })

  it('recovers gracefully from malformed lockfile content', async () => {
    await writeFile(file, 'not json at all')
    const release = await acquireLock('1.0.0', file)
    expect((await readLock(file))?.pid).toBe(process.pid)
    await release()
  })

  it('readLock returns null when file is absent', async () => {
    expect(await readLock(file)).toBeNull()
  })
})
