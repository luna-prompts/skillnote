const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8082'

export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_API_BASE
  return (localStorage.getItem('skillnote:api-url') || DEFAULT_API_BASE).replace(/\/$/, '')
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

  const res = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers })
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
