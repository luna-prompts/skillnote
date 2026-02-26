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

  // Fetch full skill from API on mount (list endpoint has empty content_md)
  useEffect(() => {
    if (isConfigured()) {
      fetchSkill(slug)
        .then(fullSkill => {
          setSkill(fullSkill)
          updateSkill(slug, fullSkill)
        })
        .catch(() => {})
    }
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
