import { Skill } from './mock-data'

export function deriveTags(skills: Skill[]) {
  const map = new Map<string, number>()
  for (const s of skills) for (const t of s.tags || []) map.set(t, (map.get(t) || 0) + 1)
  return Array.from(map.entries()).map(([name, skill_count], i) => ({ id: String(i + 1), name, skill_count }))
}

export function deriveCollections(skills: Skill[]) {
  const map = new Map<string, number>()
  for (const s of skills) for (const c of s.collections || []) map.set(c, (map.get(c) || 0) + 1)
  return Array.from(map.entries()).map(([name, skill_count], i) => ({
    id: String(i + 1),
    name,
    description: `${name} skills`,
    skill_count,
    updated_at: new Date().toISOString(),
  }))
}
