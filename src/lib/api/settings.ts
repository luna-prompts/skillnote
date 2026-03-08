import { apiRequest } from './client'

export function fetchSettings(): Promise<Record<string, string>> {
  return apiRequest<Record<string, string>>('/v1/settings')
}

export function updateSettings(patch: Record<string, string>): Promise<{ status: string }> {
  return apiRequest<{ status: string }>('/v1/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}
