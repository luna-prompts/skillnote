import { createHash } from 'node:crypto'

export function computeSha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}
