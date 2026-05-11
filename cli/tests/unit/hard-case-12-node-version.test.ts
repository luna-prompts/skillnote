/**
 * Hard case #12 — Node version too old.
 *
 * package.json declares `engines.node >= 20`. If someone runs the tests on
 * Node 18 (which they will — Node 18 is the default in many CI images) the
 * suite passes deceptively because the production source is bundled. This
 * test fails fast at the test runner so anyone on an unsupported Node sees
 * a clear, single-line failure instead of a confusing transpile error later.
 */
import { describe, expect, it } from 'vitest'

const MIN_MAJOR = 20

describe('node version', () => {
  it('is at least Node 20 (as declared in package.json engines)', () => {
    const m = process.versions.node.match(/^(\d+)\./)
    expect(m, `unparseable process.versions.node: ${process.versions.node}`).not.toBeNull()
    const major = Number.parseInt(m?.[1] ?? '0', 10)
    expect(
      major,
      `SkillNote CLI requires Node ${MIN_MAJOR}+; you are on Node ${process.versions.node}. Upgrade with nvm or your package manager.`,
    ).toBeGreaterThanOrEqual(MIN_MAJOR)
  })

  it('process.versions.node is a non-empty semver-like string', () => {
    expect(process.versions.node).toMatch(/^\d+\.\d+\.\d+/)
  })
})
