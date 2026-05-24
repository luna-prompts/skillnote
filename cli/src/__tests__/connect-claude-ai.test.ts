import { describe, expect, it } from 'vitest'

// Phase 6 — the `claude-ai` agent must be wired into the connect command's
// allowlist alongside `claude-code` and `openclaw`. These tests guard against
// a regression that drops it from the SUPPORTED_AGENTS tuple.

describe('connect command — claude-ai agent', () => {
  it('SUPPORTED_AGENTS includes claude-ai', async () => {
    const { SUPPORTED_AGENTS } = await import('../commands/connect.js')
    expect(SUPPORTED_AGENTS).toContain('claude-ai')
  })

  it('SUPPORTED_AGENTS still includes claude-code and openclaw', async () => {
    // Regression guard — adding claude-ai must not have replaced the others.
    const { SUPPORTED_AGENTS } = await import('../commands/connect.js')
    expect(SUPPORTED_AGENTS).toContain('claude-code')
    expect(SUPPORTED_AGENTS).toContain('openclaw')
  })

  it('SUPPORTED_AGENTS is a frozen tuple (readonly)', async () => {
    // The tuple is declared `as const`; assigning to it should be a TS error.
    // At runtime it's still a plain array, so this test just verifies the
    // shape is preserved (3 known names, no surprises).
    const { SUPPORTED_AGENTS } = await import('../commands/connect.js')
    expect(SUPPORTED_AGENTS).toHaveLength(3)
    const names = new Set(SUPPORTED_AGENTS)
    expect(names).toEqual(new Set(['claude-code', 'openclaw', 'claude-ai']))
  })
})
