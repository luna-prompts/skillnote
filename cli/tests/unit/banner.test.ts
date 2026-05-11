import stripAnsi from 'strip-ansi'
import { describe, expect, it } from 'vitest'
import { compactBanner, welcomeBanner } from '../../src/ui/banner.js'

// Snapshot tests guard against accidental UX regressions in the boot banner.
// Stripping ANSI codes keeps snapshots readable + portable across terminals.

describe('welcomeBanner', () => {
  it('renders the expected first-run welcome card', () => {
    const out = stripAnsi(welcomeBanner('0.5.0'))
    expect(out).toMatchSnapshot()
  })

  it('includes version and brand name', () => {
    const out = stripAnsi(welcomeBanner('1.2.3'))
    expect(out).toContain('SkillNote')
    expect(out).toContain('v1.2.3')
  })
})

describe('compactBanner', () => {
  it('renders without update hint when none provided', () => {
    const out = stripAnsi(compactBanner('0.5.0'))
    expect(out).toMatchSnapshot()
  })

  it('renders with update hint when one provided', () => {
    const out = stripAnsi(compactBanner('0.5.0', '0.5.2'))
    expect(out).toMatchSnapshot()
    expect(out).toContain('update available')
    expect(out).toContain('0.5.2')
  })
})
