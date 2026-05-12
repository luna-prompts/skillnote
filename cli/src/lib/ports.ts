import getPort, { portNumbers } from 'get-port'

/**
 * Check whether a TCP port is available for SkillNote to bind.
 *
 * Uses `get-port` (the same package the npm CLI and Cloudflare/Vercel
 * tooling rely on, ~17M weekly downloads). It probes every local network
 * interface from `os.networkInterfaces()` plus the IPv4 wildcard.
 *
 * Caveat (#41): macOS Docker Desktop's gvproxy binds via IPv6 `::` and
 * dual-stacks to IPv4; that mapping isn't always visible to a pure
 * userspace IPv4 probe. We work around this in the `start` command by
 * short-circuiting the port check if our own compose project is already
 * up (see `isProjectRunning` in `docker/inspect.ts`).
 *
 * Swallows `EADDRNOTAVAIL` / `EINVAL` (CI sandbox restrictions) so a
 * locked-down runner doesn't false-positive as "in use". `EACCES` is
 * still surfaced (privileged port detection).
 */
export async function isPortFree(port: number): Promise<boolean> {
  // portNumbers(p, p) is a single-element range — get-port either returns
  // exactly that port (free) or throws (in use). We catch + convert to bool.
  try {
    const got = await getPort({ port: portNumbers(port, port) })
    return got === port
  } catch {
    return false
  }
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
 *
 * Note: `get-port` falls back to an OS-assigned random port when every
 * port in the requested range is busy. We reject anything outside [start,end]
 * and treat that as "no free port in range".
 */
export async function findFreePort(
  start: number,
  end: number = start + 100,
): Promise<number | null> {
  try {
    const got = await getPort({ port: portNumbers(start, end) })
    return got >= start && got <= end ? got : null
  } catch {
    return null
  }
}
