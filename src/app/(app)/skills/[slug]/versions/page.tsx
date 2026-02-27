'use client'

import { use, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSkills, syncSkillsFromApi, updateSkill } from '@/lib/skills-store'
import { fetchSkill } from '@/lib/api/skills'
import { Skill } from '@/lib/mock-data'
import { TopBar } from '@/components/layout/topbar'
import { SkillVersionsTab } from '@/components/skills/tabs/SkillHistoryTab'

export default function VersionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()
  const [skill, setSkill] = useState<Skill | null>(() => getSkills().find(s => s.slug === slug) ?? null)

  useEffect(() => {
    fetchSkill(slug)
      .then(setSkill)
      .catch(() => {})
  }, [slug])

  const handleRestored = useCallback(() => {
    // Re-fetch skill after restore to get updated version
    fetchSkill(slug).then(setSkill).catch(() => {})
    syncSkillsFromApi().catch(() => {})
  }, [slug])

  if (!skill) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Skill not found.
      </div>
    )
  }

  return (
    <>
      <TopBar showFab={false} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(`/skills/${slug}`)}
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5 shrink-0"
              aria-label="Back to skill"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-foreground truncate">{skill.title}</h1>
              <p className="text-[12px] text-muted-foreground">
                Versions · {skill.current_version > 0 ? `Current: v${skill.current_version}` : 'No versions'}
              </p>
            </div>
          </div>
        </div>
        <SkillVersionsTab skillSlug={slug} onRestored={handleRestored} />
      </div>
    </>
  )
}
