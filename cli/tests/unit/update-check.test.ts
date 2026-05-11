import { describe, expect, it } from 'vitest'
import { isNewer } from '../../src/lib/update-check.js'

describe('isNewer', () => {
  it('returns true when major version is higher', () => {
    expect(isNewer('1.0.0', '0.9.99')).toBe(true)
  })

  it('returns true when minor version is higher', () => {
    expect(isNewer('0.6.0', '0.5.99')).toBe(true)
  })

  it('returns true when patch version is higher', () => {
    expect(isNewer('0.5.2', '0.5.1')).toBe(true)
  })

  it('returns false for equal versions', () => {
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
  })

  it('returns false for older versions', () => {
    expect(isNewer('0.5.0', '0.5.1')).toBe(false)
    expect(isNewer('0.4.99', '0.5.0')).toBe(false)
  })

  it('treats stable as newer than prerelease at same base', () => {
    expect(isNewer('1.0.0', '1.0.0-alpha.1')).toBe(true)
    expect(isNewer('1.0.0-alpha.1', '1.0.0')).toBe(false)
  })

  it('compares prereleases lexicographically', () => {
    expect(isNewer('1.0.0-beta.1', '1.0.0-alpha.5')).toBe(true)
    expect(isNewer('1.0.0-alpha.2', '1.0.0-alpha.1')).toBe(true)
  })
})
