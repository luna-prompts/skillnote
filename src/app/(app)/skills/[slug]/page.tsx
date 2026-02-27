'use client'

import { use, useEffect, useState, useCallback } from 'react'
import { getSkills, updateSkill } from '@/lib/skills-store'
import { fetchSkill } from '@/lib/api/skills'
import { isConfigured } from '@/lib/api/client'
import { Skill } from '@/lib/mock-data'
import { SkillDetail } from '@/components/skills/skill-detail'

export default function SkillPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const [skill, setSkill] = useState<Skill | null>(() => getSkills().find(s => s.slug === slug) ?? null)

  // Fetch full skill from API on mount + periodic sync every 30s
  useEffect(() => {
    const sync = () => {
      if (!isConfigured()) return
      fetchSkill(slug)
        .then(fullSkill => {
          // Preserve locally-set current_version if the API returns a higher number
          // (API tracks highest version, but user may have set an older version as latest)
          const local = getSkills().find(s => s.slug === slug)
          if (local && local.current_version < fullSkill.current_version) {
            fullSkill = { ...fullSkill, current_version: local.current_version }
          }
          setSkill(fullSkill)
          updateSkill(slug, fullSkill)
        })
        .catch(() => {})
    }
    sync()
    const interval = setInterval(sync, 30_000)
    return () => clearInterval(interval)
  }, [slug])

  // Called by SkillDetail after a successful save — update local state directly
  const handleSkillUpdated = useCallback((updated: Skill) => {
    setSkill(updated)
  }, [])

  if (skill === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Skill not found.
      </div>
    )
  }

  return <SkillDetail skill={skill} onSkillUpdated={handleSkillUpdated} />
}
