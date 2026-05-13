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
  // R9 F36: don't read localStorage in the initial useState — that's the SSR
  // hydration mismatch trap. Server gets [] (no window), client has the
  // skill, the two trees diverge. Populate via effect instead.
  const [skill, setSkill] = useState<Skill | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
    const local = getSkills().find(s => s.slug === slug) ?? null
    setSkill(local)
    fetchSkill(slug)
      .then(setSkill)
      .catch(() => {})
  }, [slug])

  const handleRestored = useCallback((updated: Skill) => {
    setSkill(updated)
    syncSkillsFromApi().catch(() => {})
    // Redirect if slug changed (e.g. restored version had a different name)
    if (updated.slug !== slug) {
      router.replace(`/skills/${updated.slug}/versions`)
    }
  }, [slug, router])

  if (!hydrated || !skill) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {hydrated ? 'Skill not found.' : 'Loading…'}
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
