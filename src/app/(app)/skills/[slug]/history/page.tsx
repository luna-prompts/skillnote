'use client'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, History } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { SkillHistoryTab } from '@/components/skills/tabs/SkillHistoryTab'
import { mockSkills } from '@/lib/mock-data'

export default function SkillHistoryPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const skill = mockSkills.find(s => s.slug === slug)

  if (!skill) {
    return (
      <div className="flex flex-col flex-1">
        <TopBar showFab={false} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Skill not found.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <TopBar showFab={false} />

      {/* Page header */}
      <div className="px-4 sm:px-6 py-4 border-b border-border/60 bg-card/50 shrink-0">
        <div className="flex items-center gap-3 max-w-4xl mx-auto">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground shrink-0" />
              <h1 className="text-[15px] font-semibold text-foreground truncate">Revision History</h1>
            </div>
            <p className="text-[12px] text-muted-foreground mt-0.5 truncate">{skill.title}</p>
          </div>
        </div>
      </div>

      {/* Full history content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto">
          <SkillHistoryTab revisions={skill.revisions ?? []} />
        </div>
      </div>
    </div>
  )
}
