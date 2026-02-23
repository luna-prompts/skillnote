'use client'

import { use, useState, useEffect } from 'react'
import { getSkills } from '@/lib/skills-store'
import { SkillDetail } from '@/components/skills/skill-detail'
import { notFound } from 'next/navigation'

export default function SkillPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const [skill, setSkill] = useState(() => {
    if (typeof window === 'undefined') return null
    const skills = getSkills()
    return skills.find(s => s.slug === slug) ?? null
  })

  useEffect(() => {
    const skills = getSkills()
    const found = skills.find(s => s.slug === slug)
    setSkill(found ?? null)
  }, [slug])

  if (skill === null) {
    if (typeof window !== 'undefined') {
      const skills = getSkills()
      const found = skills.find(s => s.slug === slug)
      if (!found) notFound()
    }
    return null
  }

  return <SkillDetail skill={skill} />
}
