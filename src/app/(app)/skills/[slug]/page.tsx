'use client'

import { use, useEffect, useState } from 'react'
import { getSkills, syncSkillsFromApi } from '@/lib/skills-store'
import { SkillDetail } from '@/components/skills/skill-detail'

export default function SkillPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const [skill, setSkill] = useState(() => getSkills().find(s => s.slug === slug) ?? null)

  useEffect(() => {
    syncSkillsFromApi()
      .then(skills => setSkill(skills.find(s => s.slug === slug) ?? null))
      .catch(() => {})
  }, [slug])

  if (skill === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Skill not found.
      </div>
    )
  }

  return <SkillDetail skill={skill} />
}
