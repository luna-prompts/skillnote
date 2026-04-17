import { apiRequest } from './client'

export type CollectionListItem = {
  name: string
  count: number
  description: string
}

export type CollectionDetail = {
  name: string
  description: string
  created_at: string
  updated_at: string
}

export async function fetchCollectionsApi(): Promise<CollectionListItem[]> {
  return apiRequest<CollectionListItem[]>('/v1/collections')
}

export async function fetchCollectionApi(name: string): Promise<CollectionDetail> {
  return apiRequest<CollectionDetail>(`/v1/collections/${encodeURIComponent(name)}`)
}

export async function createCollectionApi(
  name: string,
  description: string,
): Promise<CollectionDetail> {
  return apiRequest<CollectionDetail>('/v1/collections', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  })
}

export async function updateCollectionApi(
  name: string,
  description: string,
): Promise<CollectionDetail> {
  return apiRequest<CollectionDetail>(`/v1/collections/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({ description }),
  })
}

export async function deleteCollectionApi(name: string): Promise<void> {
  await apiRequest<void>(`/v1/collections/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}
