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
 * Probes `127.0.0.1` by default. On Linux this catches everything
 * (IPv4/IPv6 share the namespace by default, so any wildcard listener
 * is detected). On macOS with Docker Desktop, IPv6-only gvproxy binds
 * can be missed (the IPv6 namespace is separate); the dev-time error
 * surfaces as a docker compose up failure rather than a clean port-in-use
 * message, which is acceptable for now.
 *
 * History: Round 2 tried a dual-probe (127.0.0.1 + 0.0.0.0) to catch
 * the macOS gvproxy case, but the two probes self-conflict (overlapping
 * addresses) and 0.0.0.0 binds are denied in some Linux CI sandboxes.
 * Reverted to the simpler probe; the macOS edge case is a known
 * follow-up.
 */
export async function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return tryBind(port, host)
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
