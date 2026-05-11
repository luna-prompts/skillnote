import { createServer } from 'node:net'

/**
 * Try to bind a TCP port on the given host. Returns true if the bind
 * succeeded (port is free), false on any error (in use or denied).
 */
function tryBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

/**
 * Check whether a TCP port is available for SkillNote to bind.
 *
 * Docker Desktop / podman / gvproxy on macOS binds host ports via IPv6 `::`
 * (which dual-stacks to IPv4 0.0.0.0). A naive check on `127.0.0.1` alone
 * MISSES that listener — gvproxy is still receiving traffic on 127.0.0.1
 * because the IPv4 socket is part of the dual-stack bind, but a fresh
 * 127.0.0.1-only bind succeeds due to SO_REUSEADDR / kernel quirks.
 *
 * To detect ALL collisions reliably, we try to bind on multiple addresses
 * and call the port "free" only if every probe succeeds. This catches:
 *   - 127.0.0.1-only listeners (e.g., a python script)
 *   - 0.0.0.0/IPv4-wildcard listeners (Docker bridge mode)
 *   - ::/IPv6-wildcard listeners (Docker Desktop gvproxy)
 *
 * The default checks the union of 127.0.0.1 and 0.0.0.0 which covers the
 * common cases on macOS, Linux, and Windows.
 */
export async function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  // Caller can override host to test a single interface; default to the
  // robust multi-address probe.
  if (host !== '127.0.0.1') {
    return tryBind(port, host)
  }
  const results = await Promise.all([tryBind(port, '127.0.0.1'), tryBind(port, '0.0.0.0')])
  return results.every(Boolean)
}

export interface PortCheckResult {
  port: number
  free: boolean
  service: string
}

export async function checkPorts(
  spec: { service: string; port: number }[],
): Promise<PortCheckResult[]> {
  return Promise.all(
    spec.map(async ({ service, port }) => ({
      service,
      port,
      free: await isPortFree(port),
    })),
  )
}

/**
 * Find the first free port at or after `start`, capped at `end`.
 * Returns null if nothing free in range.
 */
export async function findFreePort(
  start: number,
  end: number = start + 100,
): Promise<number | null> {
  for (let p = start; p <= end; p++) {
    if (await isPortFree(p)) return p
  }
  return null
}
