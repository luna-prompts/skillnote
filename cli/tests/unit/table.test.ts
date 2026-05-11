import stripAnsi from 'strip-ansi'
import { describe, expect, it } from 'vitest'
import { agentTable, serviceTable, urlTable } from '../../src/ui/table.js'

describe('urlTable', () => {
  it('renders rows with label and URL columns', () => {
    const out = stripAnsi(urlTable([{ label: 'Web', url: 'http://localhost:3000' }]))
    expect(out).toContain('Web')
    expect(out).toContain('http://localhost:3000')
  })

  it('handles multiple rows', () => {
    const out = stripAnsi(
      urlTable([
        { label: 'A', url: 'http://a' },
        { label: 'B', url: 'http://b' },
      ]),
    )
    expect(out).toContain('http://a')
    expect(out).toContain('http://b')
  })
})

describe('agentTable', () => {
  it('renders with header columns', () => {
    const out = stripAnsi(agentTable([{ agent: 'claude', status: 'ok', lastActivity: '5m' }]))
    expect(out).toContain('Agent')
    expect(out).toContain('Status')
    expect(out).toContain('claude')
    expect(out).toContain('5m')
  })
})

describe('serviceTable', () => {
  it('renders rows with optional meta', () => {
    const out = stripAnsi(serviceTable([{ service: 'api', health: 'healthy', meta: 'up 1h' }]))
    expect(out).toContain('api')
    expect(out).toContain('healthy')
    expect(out).toContain('up 1h')
  })

  it('omits meta cleanly when not provided', () => {
    const out = stripAnsi(serviceTable([{ service: 'web', health: 'running' }]))
    expect(out).toContain('web')
    expect(out).toContain('running')
  })
})
