const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8082'

/**
 * R9 F52: validate the stored override is an actual absolute http(s) URL
 * before we hand it to `fetch`. Garbage in localStorage (corrupted by an
 * extension, a stale dev experiment, or a malicious script) would otherwise
 * become a relative URL resolved against `window.location.origin` — fetches
 * end up at `http://localhost:3000/<garbage>/v1/skills` and 404 forever
 * until the user manually clears the key. Refusing to honour a malformed
 * value (and falling back to the build-time default) keeps the app
 * recoverable without user intervention.
 */
function isValidApiUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_API_BASE
  let stored: string | null = null
  try {
    stored = localStorage.getItem('skillnote:api-url')
  } catch {
    // Storage access denied (Safari private mode, etc.) — fall through.
  }
  if (stored && isValidApiUrl(stored)) {
    return stored.replace(/\/$/, '')
  }
  // If the stored value was present but malformed, silently drop it so the
  // user isn't stuck. We don't surface a banner here because the
  // ConnectionBanner already shows "Backend unreachable" when calls fail —
  // double-banner would be noisy.
  if (stored !== null) {
    try {
      localStorage.removeItem('skillnote:api-url')
    } catch {
      // ignore
    }
  }
  return DEFAULT_API_BASE.replace(/\/$/, '')
}

export type ApiError = {
  code: string
  message: string
}

export class SkillNoteApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {})
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')

  // 15s timeout prevents UI from hanging if backend is unresponsive
  const signal = init.signal || AbortSignal.timeout(15_000)
  const res = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers, signal })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      code = body?.error?.code || code
      message = body?.error?.message || body?.detail || message
    } catch {}
    throw new SkillNoteApiError(code, message, res.status)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
