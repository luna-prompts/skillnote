import { Skill } from './mock-data'

export function deriveCollections(skills: Skill[]) {
  const map = new Map<string, { count: number; updatedAt: string }>()
  for (const s of skills) {
    for (const c of s.collections || []) {
      const cur = map.get(c) || { count: 0, updatedAt: s.updated_at }
      map.set(c, { count: cur.count + 1, updatedAt: s.updated_at > cur.updatedAt ? s.updated_at : cur.updatedAt })
    }
  }

  // Merge meta collections (created but may have 0 skills)
  if (typeof window !== 'undefined') {
    try {
      const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
      for (const [name, data] of Object.entries(meta as Record<string, { description: string; created_at: string }>)) {
        if (!map.has(name)) map.set(name, { count: 0, updatedAt: (data as { description: string; created_at: string }).created_at })
      }
    } catch {}
  }

  return Array.from(map.entries()).map(([name, { count, updatedAt }], i) => {
    const metaRaw = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}') : {}
    const meta = metaRaw[name] as { description?: string } | undefined
    return {
      id: String(i + 1),
      name,
      description: meta?.description || `${name} skills`,
      skill_count: count,
      updated_at: updatedAt,
    }
  })
}
