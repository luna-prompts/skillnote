import { apiRequest } from './client'

export type PickSession = {
  token: string
  pick_url: string
  expires_at: string
}

export type PickSessionStatus = {
  status: 'pending' | 'completed'
  collections: string[] | null
}

export async function createPickSession(): Promise<PickSession> {
  return apiRequest<PickSession>('/v1/sessions', { method: 'POST' })
}

export async function pollPickSession(token: string): Promise<PickSessionStatus> {
  return apiRequest<PickSessionStatus>(`/v1/sessions/${token}`)
}

export async function resolvePickSession(token: string, collections: string[]): Promise<void> {
  await apiRequest<{ status: string }>(`/v1/sessions/${token}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ collections }),
  })
}
