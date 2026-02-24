const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8082'

export function getApiBaseUrl() {
  return API_BASE.replace(/\/$/, '')
}

export function getAuthToken() {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('skillnote:token') || 'skn_dev_demo_token'
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken()
  const headers = new Headers(init.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')

  const res = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers, cache: 'no-store' })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      msg = body?.error?.message || body?.detail || msg
    } catch {}
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}
