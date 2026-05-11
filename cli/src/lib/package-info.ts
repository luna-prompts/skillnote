// Build-time constants injected by tsup's `define`. Falls back to test-mode
// defaults when imported from vitest (which doesn't go through tsup).
declare const __SKILLNOTE_VERSION__: string | undefined
declare const __SKILLNOTE_NAME__: string | undefined

const SKILLNOTE_VERSION =
  typeof __SKILLNOTE_VERSION__ === 'string' ? __SKILLNOTE_VERSION__ : '0.0.0-dev'
const SKILLNOTE_NAME = typeof __SKILLNOTE_NAME__ === 'string' ? __SKILLNOTE_NAME__ : 'skillnote'

interface PackageInfo {
  name: string
  version: string
}

export const pkgInfo: PackageInfo = {
  name: SKILLNOTE_NAME,
  version: SKILLNOTE_VERSION,
}
