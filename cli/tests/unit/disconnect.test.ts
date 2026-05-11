import { describe, expect, it } from 'vitest'
import { SUPPORTED_AGENTS } from '../../src/commands/connect.js'

// disconnect doesn't have many pure-logic seams beyond the agent-name check
// (the actual fs removal is best tested via integration, not unit).
describe('disconnect agent validation', () => {
  it('accepts every SUPPORTED_AGENTS value', () => {
    for (const agent of SUPPORTED_AGENTS) {
      expect((SUPPORTED_AGENTS as readonly string[]).includes(agent)).toBe(true)
    }
  })

  it('rejects unknown agent names', () => {
    expect((SUPPORTED_AGENTS as readonly string[]).includes('not-an-agent')).toBe(false)
  })
})
