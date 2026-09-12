import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/docker/compose.js', () => ({
  composePs: vi.fn(),
}))

import { type ComposeOptions, type ComposeService, composePs } from '../../src/docker/compose.js'
import { snapshot, waitForHealthy } from '../../src/docker/health.js'

const opts: ComposeOptions = { composeFile: 'docker-compose.yml' }

function service(name: string, state: string, health?: string, status = state): ComposeService {
  return {
    Name: `skillnote-${name}-1`,
    Service: name,
    State: state,
    Status: status,
    Health: health,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('snapshot', () => {
  it('test_snapshot_maps_compose_health_states', async () => {
    vi.mocked(composePs).mockResolvedValueOnce([
      service('api', 'running', 'healthy'),
      service('web', 'running', 'starting'),
      service('worker', 'running', 'unhealthy'),
      service('postgres', 'running'),
      service('migrate', 'exited'),
    ])

    const result = await snapshot(opts)

    expect(result).toEqual([
      { service: 'api', state: 'running', health: 'healthy', status: 'running' },
      { service: 'web', state: 'running', health: 'starting', status: 'running' },
      { service: 'worker', state: 'running', health: 'unhealthy', status: 'running' },
      { service: 'postgres', state: 'running', health: 'unknown', status: 'running' },
      { service: 'migrate', state: 'exited', health: 'unknown', status: 'exited' },
    ])
  })
})

describe('waitForHealthy', () => {
  it('test_waitForHealthy_returns_immediately_when_all_services_are_healthy', async () => {
    const healthy = [service('api', 'running', 'healthy')]
    vi.mocked(composePs).mockResolvedValueOnce(healthy)

    const result = await waitForHealthy(opts, ['api'])

    expect(result[0]?.health).toBe('healthy')
    expect(composePs).toHaveBeenCalledOnce()
  })

  it('test_waitForHealthy_accepts_running_services_without_healthchecks', async () => {
    const running = [service('web', 'running')]
    const onUpdate = vi.fn()
    vi.mocked(composePs).mockResolvedValueOnce(running)

    const result = await waitForHealthy(opts, ['web'], { onUpdate })

    expect(result[0]?.health).toBe('unknown')
    expect(onUpdate).toHaveBeenCalledWith([
      { service: 'web', state: 'running', health: 'unknown', status: 'running' },
    ])
  })

  it('test_waitForHealthy_returns_the_latest_snapshot_after_timeout', async () => {
    vi.useFakeTimers()
    const unhealthy = [service('api', 'running', 'unhealthy')]
    const final = [service('api', 'exited', 'unhealthy')]
    vi.mocked(composePs).mockResolvedValueOnce(unhealthy).mockResolvedValueOnce(final)

    const pending = waitForHealthy(opts, ['api'], { timeoutMs: 10, intervalMs: 10 })
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result).toEqual([
      { service: 'api', state: 'exited', health: 'unhealthy', status: 'exited' },
    ])
    expect(composePs).toHaveBeenCalledTimes(2)
  })
})
