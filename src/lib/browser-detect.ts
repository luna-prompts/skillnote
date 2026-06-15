/**
 * Lightweight browser detection for the claude.ai connector onboarding.
 *
 * Why not feature-detect? Because the onboarding copy is fundamentally
 * different per browser ("chrome://extensions" vs "about:debugging") and
 * we ship different install instructions accordingly. We never branch
 * runtime behavior on this — only copy.
 *
 * User-Agent sniffing is fragile by design; if a future browser doesn't
 * match a known family we fall back to generic "your browser" copy
 * rather than guessing wrong.
 */

export type BrowserFamily =
  | 'chrome'
  | 'edge'
  | 'brave'
  | 'arc'
  | 'firefox'
  | 'safari'
  | 'unknown'

export interface BrowserInfo {
  family: BrowserFamily
  /** Human-readable label, e.g. "Chrome on macOS". Mirrors the
   *  defaultBrowserLabel() helper in the extension. */
  label: string
  /** Browser-specific URL the user should open to load an unpacked
   *  extension. null for unknown / Safari. */
  extensionsUrl: string | null
  /** Whether the browser is Chromium-based (Chrome MV3 extensions
   *  install identically). Used to collapse multiple flavors into one
   *  set of instructions. */
  chromiumLike: boolean
}

export function detectBrowser(
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): BrowserInfo {
  const ua = userAgent

  // Order matters: Edge/Brave/Arc all include "Chrome/" in their UA, so
  // probe for them BEFORE Chrome itself.
  if (/Edg\//.test(ua)) return mkInfo('edge', ua, 'edge://extensions', true)
  if (/Arc\//.test(ua)) return mkInfo('arc', ua, 'arc://extensions', true)
  // Brave reports itself only via navigator.brave (runtime check), but its
  // UA still includes Chrome/. We treat Brave as Chromium-equivalent and
  // detect via the runtime probe below.
  if (typeof navigator !== 'undefined' && 'brave' in navigator) {
    return mkInfo('brave', ua, 'brave://extensions', true)
  }
  if (/Firefox\//.test(ua)) return mkInfo('firefox', ua, 'about:debugging#/runtime/this-firefox', false)
  if (/Chrome\//.test(ua)) return mkInfo('chrome', ua, 'chrome://extensions', true)
  if (/Safari\//.test(ua)) return mkInfo('safari', ua, null, false)
  return mkInfo('unknown', ua, null, false)
}

function mkInfo(
  family: BrowserFamily,
  ua: string,
  extensionsUrl: string | null,
  chromiumLike: boolean,
): BrowserInfo {
  let os = ''
  if (/Mac/.test(ua)) os = ' on macOS'
  else if (/Win/.test(ua)) os = ' on Windows'
  else if (/Linux/.test(ua)) os = ' on Linux'
  const label = `${prettyName(family)}${os}`
  return { family, label, extensionsUrl, chromiumLike }
}

function prettyName(family: BrowserFamily): string {
  switch (family) {
    case 'chrome': return 'Chrome'
    case 'edge': return 'Edge'
    case 'brave': return 'Brave'
    case 'arc': return 'Arc'
    case 'firefox': return 'Firefox'
    case 'safari': return 'Safari'
    case 'unknown': return 'Your browser'
  }
}
