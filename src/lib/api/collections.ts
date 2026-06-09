import { apiRequest } from './client'

export type CollectionListItem = {
  name: string
  count: number
  description: string
  published_to_claude_ai?: boolean
}

export type CollectionDetail = {
  name: string
  description: string
  published_to_claude_ai?: boolean
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

/** Toggle whether a collection is published to claude.ai as its own plugin
 *  group ("SkillNote: <name>"). The connector's extension picks up the change
 *  on its next sync tick (a publish_group op is enqueued server-side). */
export async function setCollectionClaudeAiPublishApi(
  name: string,
  published: boolean,
): Promise<CollectionDetail> {
  return apiRequest<CollectionDetail>(
    `/v1/collections/${encodeURIComponent(name)}/claude-ai`,
    {
      method: 'PUT',
      body: JSON.stringify({ published }),
    },
  )
}
