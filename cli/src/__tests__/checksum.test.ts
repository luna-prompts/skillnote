import { describe, it, expect } from 'vitest'
import { computeSha256 } from '../util/checksum.js'

describe('computeSha256', () => {
  it('computes correct hash of a buffer', () => {
    const buf = Buffer.from('hello world')
    const hash = computeSha256(buf)
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
  })
})
