'use client'
import { TopBar } from '@/components/layout/topbar'
import { SkillListItem } from '@/components/skills/skill-list-item'
import { ArrowLeft, FolderOpen } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { getSkills, syncSkillsFromApi } from '@/lib/skills-store'

export default function CollectionDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const [skills, setSkills] = useState(getSkills())
  useEffect(() => {
    syncSkillsFromApi().then(setSkills).catch(() => {})
  }, [])

  const collectionName = decodeURIComponent(slug).replace(/-/g, ' ')
  const filtered = useMemo(() => skills.filter(s => (s.collections || []).some(c => c.toLowerCase() === collectionName.toLowerCase())), [skills, collectionName])

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-auto">
        <div className="px-6 py-5 border-b border-border/60">
          <div className="flex items-center gap-2 mb-3">
            <Link href="/collections" className="text-muted-foreground hover:text-foreground transition-colors p-0.5" aria-label="Back to collections">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="text-[12px] text-muted-foreground">Collections</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
              <FolderOpen className="h-4.5 w-4.5 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">{collectionName}</h1>
              <p className="text-[13px] text-muted-foreground">Collection details from live skills</p>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-border/60 bg-card/20">
          <p className="text-[12px] text-muted-foreground"><span className="font-medium text-foreground">{filtered.length}</span> skill{filtered.length !== 1 ? 's' : ''} in this collection</p>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-6">
            <div className="w-12 h-12 rounded-xl bg-muted/80 flex items-center justify-center mb-4"><FolderOpen className="h-6 w-6 text-muted-foreground/60" /></div>
            <p className="text-[14px] font-medium text-foreground mb-1">No skills yet</p>
            <p className="text-[13px] text-muted-foreground text-center max-w-xs">This collection doesn&apos;t have any skills yet.</p>
          </div>
        ) : (
          <div className="relative">{filtered.map(skill => <SkillListItem key={skill.slug} skill={skill} />)}</div>
        )}
      </main>
    </>
  )
}
