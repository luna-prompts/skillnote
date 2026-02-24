'use client'
import Link from 'next/link'
import { TopBar } from '@/components/layout/topbar'
import { FolderOpen, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatRelative } from '@/lib/format'
import { useEffect, useMemo, useState } from 'react'
import { getSkills, syncSkillsFromApi } from '@/lib/skills-store'
import { deriveCollections } from '@/lib/derived'

const COLLECTION_COLORS = [
  { bg: 'bg-violet-100 dark:bg-violet-950/40', icon: 'text-violet-600 dark:text-violet-400', hover: 'hover:border-violet-400/40', accent: '#8b5cf6' },
  { bg: 'bg-blue-100 dark:bg-blue-950/40', icon: 'text-blue-600 dark:text-blue-400', hover: 'hover:border-blue-400/40', accent: '#3b82f6' },
  { bg: 'bg-teal-100 dark:bg-teal-950/40', icon: 'text-teal-600 dark:text-teal-400', hover: 'hover:border-teal-400/40', accent: '#14b8a6' },
  { bg: 'bg-amber-100 dark:bg-amber-950/40', icon: 'text-amber-600 dark:text-amber-400', hover: 'hover:border-amber-400/40', accent: '#f59e0b' },
  { bg: 'bg-rose-100 dark:bg-rose-950/40', icon: 'text-rose-600 dark:text-rose-400', hover: 'hover:border-rose-400/40', accent: '#f43f5e' },
]

export default function CollectionsPage() {
  const [skills, setSkills] = useState(getSkills())
  useEffect(() => {
    syncSkillsFromApi().then(setSkills).catch(() => {})
  }, [])
  const collections = useMemo(() => deriveCollections(skills), [skills])

  return (
    <>
      <TopBar />
      <main className="flex-1 p-4 sm:p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Collections</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">{collections.length} collections</p>
          </div>
          <Button size="sm" className="h-8 gap-1.5 text-[13px] bg-foreground hover:bg-foreground/90 text-background border-0" disabled>
            <Plus className="h-3.5 w-3.5" />
            New Collection
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-24 lg:pb-0">
          {collections.map((col, i) => {
            const color = COLLECTION_COLORS[i % COLLECTION_COLORS.length]
            const slug = col.name.toLowerCase().replace(/\s+/g, '-')
            return (
              <Link key={col.id} href={`/collections/${slug}`} className={`bg-card rounded-xl border border-border/60 overflow-hidden ${color.hover} hover:shadow-[0_4px_24px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_4px_24px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 active:scale-[0.99] transition-all duration-200 cursor-pointer group block`}>
                <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${color.accent}, ${color.accent}80)` }} />
                <div className="p-5">
                  <div className="flex items-start gap-3 mb-4">
                    <div className={`w-9 h-9 rounded-lg ${color.bg} flex items-center justify-center shrink-0`}>
                      <FolderOpen className={`h-4.5 w-4.5 ${color.icon}`} />
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <h3 className="text-[14px] font-semibold text-foreground group-hover:text-accent transition-colors">{col.name}</h3>
                      <p className="text-[12px] text-muted-foreground/70 mt-0.5 line-clamp-2">{col.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-border/40">
                    <span className="text-[12px] font-medium text-muted-foreground"><span className="text-foreground font-semibold">{col.skill_count}</span> skills</span>
                    <span className="text-[11px] text-muted-foreground/50 tabular-nums">{formatRelative(col.updated_at)}</span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </main>
    </>
  )
}
