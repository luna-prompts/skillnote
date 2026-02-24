import { Skill } from '@/lib/mock-data'
import { apiRequest } from './client'

type SkillListItem = {
  name: string
  slug: string
  description: string
  latestVersion?: string
}

function toSkill(item: SkillListItem): Skill {
  const now = new Date().toISOString()
  return {
    slug: item.slug,
    title: item.name,
    description: item.description,
    content_md: item.description,
    tags: [],
    collections: [],
    created_at: now,
    updated_at: now,
  }
}

export async function fetchSkills(): Promise<Skill[]> {
  const list = await apiRequest<SkillListItem[]>('/v1/skills')
  return list.map(toSkill)
}
