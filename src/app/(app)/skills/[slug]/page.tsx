'use client'

import { use, useEffect, useState, useCallback } from 'react'
import { getSkills, updateSkill } from '@/lib/skills-store'
import { fetchSkill } from '@/lib/api/skills'
import { Skill } from '@/lib/mock-data'
import { SkillDetail } from '@/components/skills/skill-detail'
import { useRouter } from 'next/navigation'

export default function SkillPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()
  const [skill, setSkill] = useState<Skill | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // Read localStorage only after hydration to avoid SSR mismatch
  useEffect(() => {
    const found = getSkills().find(s => s.slug === slug) ?? null
    setSkill(found)
    setHydrated(true)
  }, [slug])

  // Fetch full skill from API on mount
  useEffect(() => {
    fetchSkill(slug)
      .then(fullSkill => {
        setSkill(fullSkill)
        updateSkill(slug, fullSkill)
      })
      .catch(() => {})
  }, [slug])

  // Called by SkillDetail after a successful save — update local state directly
  const handleSkillUpdated = useCallback((updated: Skill) => {
    setSkill(updated)
    // Redirect if slug changed (e.g. skill was renamed)
    if (updated.slug !== slug) {
      router.replace(`/skills/${updated.slug}`)
    }
  }, [slug, router])

  if (!hydrated) {
    return null
  }

  if (skill === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Skill not found.
      </div>
    )
  }

  return <SkillDetail skill={skill} onSkillUpdated={handleSkillUpdated} />
}
