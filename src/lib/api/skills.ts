import { Skill, Comment, ContentVersion } from '@/lib/mock-data'
import { apiRequest } from './client'

type ApiSkillListItem = {
  name: string
  slug: string
  description: string
  tags?: string[]
  collections?: string[]
  latestVersion?: string
  currentVersion?: number
}

type ApiSkillDetail = {
  id: string
  name: string
  slug: string
  description: string
  content_md: string
  tags: string[]
  collections: string[]
  current_version: number
  total_versions: number
  created_at: string
  updated_at: string
}

type ApiComment = {
  id: string
  author: string
  body: string
  created_at: string
  updated_at: string
}

function listItemToSkill(item: ApiSkillListItem): Skill {
  const now = new Date().toISOString()
  return {
    slug: item.slug,
    title: item.name,
    description: item.description,
    content_md: '',
    tags: item.tags || [],
    collections: item.collections || [],
    current_version: item.currentVersion || 0,
    created_at: now,
    updated_at: now,
  }
}

function detailToSkill(item: ApiSkillDetail, existingComments?: Comment[]): Skill {
  return {
    slug: item.slug,
    title: item.name,
    description: item.description,
    content_md: item.content_md || '',
    tags: item.tags || [],
    collections: item.collections || [],
    current_version: item.current_version || 0,
    total_versions: item.total_versions || 0,
    created_at: item.created_at,
    updated_at: item.updated_at,
    comments: existingComments,
  }
}

export async function fetchSkills(): Promise<Skill[]> {
  const list = await apiRequest<ApiSkillListItem[]>('/v1/skills')
  return list.map(listItemToSkill)
}

export async function fetchSkill(slug: string): Promise<Skill> {
  const [detail, comments] = await Promise.all([
    apiRequest<ApiSkillDetail>(`/v1/skills/${slug}`),
    fetchComments(slug).catch(() => [] as Comment[]),
  ])
  return detailToSkill(detail, comments)
}

export async function createSkillApi(data: {
  name: string
  slug: string
  description: string
  content_md: string
  tags: string[]
  collections: string[]
}): Promise<Skill> {
  const detail = await apiRequest<ApiSkillDetail>('/v1/skills', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return detailToSkill(detail)
}

export async function updateSkillApi(slug: string, data: {
  name?: string
  description?: string
  content_md?: string
  tags?: string[]
  collections?: string[]
}): Promise<Skill> {
  const detail = await apiRequest<ApiSkillDetail>(`/v1/skills/${slug}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  return detailToSkill(detail)
}

export async function deleteSkillApi(slug: string): Promise<void> {
  await apiRequest<void>(`/v1/skills/${slug}`, { method: 'DELETE' })
}

export async function fetchComments(slug: string): Promise<Comment[]> {
  const list = await apiRequest<ApiComment[]>(`/v1/skills/${slug}/comments`)
  return list.map(c => ({
    id: c.id,
    author: c.author,
    avatar_color: '#6366f1',
    body: c.body,
    created_at: c.created_at,
    reactions: [],
  }))
}

export async function createCommentApi(slug: string, author: string, body: string): Promise<Comment> {
  const c = await apiRequest<ApiComment>(`/v1/skills/${slug}/comments`, {
    method: 'POST',
    body: JSON.stringify({ author, body }),
  })
  return { id: c.id, author: c.author, avatar_color: '#6366f1', body: c.body, created_at: c.created_at, reactions: [] }
}

export async function updateCommentApi(slug: string, commentId: string, body: string): Promise<void> {
  await apiRequest(`/v1/skills/${slug}/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  })
}

export async function deleteCommentApi(slug: string, commentId: string): Promise<void> {
  await apiRequest(`/v1/skills/${slug}/comments/${commentId}`, { method: 'DELETE' })
}

export async function fetchTagsApi(): Promise<{ name: string; skill_count: number }[]> {
  return apiRequest('/v1/tags')
}

export async function renameTagApi(oldName: string, newName: string): Promise<void> {
  await apiRequest(`/v1/tags/${encodeURIComponent(oldName)}`, {
    method: 'PATCH',
    body: JSON.stringify({ new_name: newName }),
  })
}

export async function deleteTagApi(name: string): Promise<void> {
  await apiRequest(`/v1/tags/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

// Content versions
type ApiContentVersion = {
  version: number
  title: string
  description: string
  content_md: string
  tags: string[]
  collections: string[]
  is_latest: boolean
  created_at: string
}

export async function fetchContentVersions(slug: string): Promise<ContentVersion[]> {
  const list = await apiRequest<ApiContentVersion[]>(`/v1/skills/${slug}/content-versions`)
  return list.map(v => ({
    version: v.version,
    title: v.title,
    description: v.description,
    content_md: v.content_md,
    tags: v.tags || [],
    collections: v.collections || [],
    is_latest: v.is_latest,
    created_at: v.created_at,
  }))
}

export async function setLatestVersionApi(slug: string, version: number): Promise<Skill> {
  const detail = await apiRequest<ApiSkillDetail>(`/v1/skills/${slug}/content-versions/${version}/set-latest`, {
    method: 'POST',
  })
  return detailToSkill(detail)
}

