import { type ComposeOptions, type ComposeService, composePs } from './compose.js'

export type HealthStatus = 'healthy' | 'starting' | 'unhealthy' | 'unknown' | 'absent'

export interface ServiceHealth {
  service: string
  state: string
  health: HealthStatus
  status: string
}

/**
 * Snapshot the current health of each compose service.
 * `state` is the container lifecycle (running/exited/created); `health` is the
 * Docker HEALTHCHECK verdict (or 'unknown' if the service didn't declare one).
 */
export async function snapshot(opts: ComposeOptions): Promise<ServiceHealth[]> {
  const services = await composePs(opts)
  return services.map(toHealth)
}

function toHealth(svc: ComposeService): ServiceHealth {
  let health: HealthStatus = 'unknown'
  if (svc.Health === 'healthy') health = 'healthy'
  else if (svc.Health === 'starting') health = 'starting'
  else if (svc.Health === 'unhealthy') health = 'unhealthy'
  else if (svc.State === 'running') health = 'unknown' // no healthcheck declared but running

  return {
    service: svc.Service,
    state: svc.State,
    health,
    status: svc.Status,
  }
}

/**
 * Poll until every named service reports `healthy` (or the timeout elapses).
 * `onUpdate` is called with each new snapshot — used to drive a live spinner.
 */
export async function waitForHealthy(
  opts: ComposeOptions,
  services: string[],
  options: {
    timeoutMs?: number
    intervalMs?: number
    onUpdate?: (snap: ServiceHealth[]) => void
  } = {},
): Promise<ServiceHealth[]> {
  const timeoutMs = options.timeoutMs ?? 120_000
  const intervalMs = options.intervalMs ?? 1_000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const snap = await snapshot(opts)
    options.onUpdate?.(snap)
    const allHealthy = services.every((s) => {
      const entry = snap.find((x) => x.service === s)
      return (
        entry?.health === 'healthy' || (entry?.state === 'running' && entry?.health === 'unknown')
      )
    })
    if (allHealthy) return snap
    await sleep(intervalMs)
  }

  // Timeout — return last snapshot so caller can surface which service failed.
  return snapshot(opts)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
