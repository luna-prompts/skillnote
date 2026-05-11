import { type Server, createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { checkPorts, findFreePort, isPortFree } from '../../src/lib/ports.js'

const blockedServers: Server[] = []

afterEach(async () => {
  for (const s of blockedServers) {
    await new Promise<void>((r) => s.close(() => r()))
  }
  blockedServers.length = 0
})

async function bind(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(port, '127.0.0.1', () => {
      blockedServers.push(s)
      resolve()
    })
  })
}

describe('isPortFree', () => {
  it('returns true when port is free', async () => {
    // 0 = let OS pick; we use a high port unlikely to collide.
    const port = 51721
    const free = await isPortFree(port)
    expect(free).toBe(true)
  })

  it('returns false when port is in use', async () => {
    const port = 51722
    await bind(port)
    expect(await isPortFree(port)).toBe(false)
  })

  it('respects an explicit single-host override', async () => {
    // Caller can still target a single interface.
    const port = 51724
    await bindOn(port, '127.0.0.1')
    expect(await isPortFree(port, '127.0.0.1')).toBe(false)
  })

  // Note: Docker Desktop gvproxy on macOS binds host ports via IPv6
  // dual-stack, which our IPv4-127.0.0.1 probe doesn't detect. The
  // failure mode is a confusing `docker compose up` error rather than a
  // clean port-in-use message; a future iteration could probe IPv6 too.
})

async function bindOn(port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(port, host, () => {
      blockedServers.push(s)
      resolve()
    })
  })
}

describe('checkPorts', () => {
  it('returns free/in-use for a list of services', async () => {
    const used = 51731
    const free = 51732
    await bind(used)
    const result = await checkPorts([
      { service: 'web', port: used },
      { service: 'api', port: free },
    ])
    expect(result).toEqual([
      { service: 'web', port: used, free: false },
      { service: 'api', port: free, free: true },
    ])
  })
})

describe('findFreePort', () => {
  it('returns the first free port at or after start', async () => {
    const start = 51741
    await bind(start)
    const found = await findFreePort(start, start + 5)
    expect(found).toBe(start + 1)
  })

  it('returns null when no free port in range', async () => {
    const start = 51751
    await bind(start)
    await bind(start + 1)
    const found = await findFreePort(start, start + 1)
    expect(found).toBeNull()
  })
})
