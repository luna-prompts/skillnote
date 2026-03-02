'use client'
import Link from 'next/link'
import { TopBar } from '@/components/layout/topbar'
import { FolderOpen, Plus, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatRelative } from '@/lib/format'
import { useEffect, useMemo, useState } from 'react'
import { getSkills, syncSkillsFromApi } from '@/lib/skills-store'
import { deriveCollections } from '@/lib/derived'
import { NewCollectionModal } from '@/components/collections/NewCollectionModal'
import type { Skill } from '@/lib/mock-data'

const COLLECTION_COLORS = [
  { bg: 'bg-violet-100 dark:bg-violet-950/40', icon: 'text-violet-600 dark:text-violet-400', hover: 'hover:border-violet-400/40', accent: '#8b5cf6' },
  { bg: 'bg-blue-100 dark:bg-blue-950/40',     icon: 'text-blue-600 dark:text-blue-400',     hover: 'hover:border-blue-400/40',   accent: '#3b82f6' },
  { bg: 'bg-teal-100 dark:bg-teal-950/40',     icon: 'text-teal-600 dark:text-teal-400',     hover: 'hover:border-teal-400/40',   accent: '#14b8a6' },
  { bg: 'bg-amber-100 dark:bg-amber-950/40',   icon: 'text-amber-600 dark:text-amber-400',   hover: 'hover:border-amber-400/40',  accent: '#f59e0b' },
  { bg: 'bg-rose-100 dark:bg-rose-950/40',     icon: 'text-rose-600 dark:text-rose-400',     hover: 'hover:border-rose-400/40',   accent: '#f43f5e' },
]

function getSkillsForCollection(skills: Skill[], name: string): Skill[] {
  return skills.filter(s => (s.collections || []).some(c => c.toLowerCase() === name.toLowerCase()))
}

export default function CollectionsPage() {
  const [skills, setSkills] = useState(getSkills())
  const [newCollectionOpen, setNewCollectionOpen] = useState(false)

  useEffect(() => {
    syncSkillsFromApi().then(setSkills).catch(() => {})
  }, [])

  const collections = useMemo(() => deriveCollections(skills), [skills])

  function handleCollectionCreated(_name: string, _desc: string) {
    setSkills(s => [...s])
    setNewCollectionOpen(false)
  }

  return (
    <>
      <TopBar />
      <main className="flex-1 p-4 sm:p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Collections</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              {collections.length === 0 ? 'No collections yet' : `${collections.length} collection${collections.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-[13px] bg-foreground hover:bg-foreground/90 text-background border-0"
            onClick={() => setNewCollectionOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            New Collection
          </Button>
        </div>

        {/* Empty state */}
        {collections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-6">
            <div className="w-16 h-16 rounded-2xl bg-muted/60 border border-border/40 flex items-center justify-center mb-5">
              <FolderOpen className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <p className="text-[15px] font-semibold text-foreground mb-2">No collections yet</p>
            <p className="text-[13px] text-muted-foreground text-center max-w-[260px] mb-6 leading-relaxed">
              Group your skills into collections to keep things organised.
            </p>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-[13px] bg-foreground hover:bg-foreground/90 text-background border-0"
              onClick={() => setNewCollectionOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New Collection
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-24 lg:pb-0">
            {collections.map((col, i) => {
              const color = COLLECTION_COLORS[i % COLLECTION_COLORS.length]
              const slug = col.name.toLowerCase().replace(/\s+/g, '-')
              const preview = getSkillsForCollection(skills, col.name).slice(0, 3)
              const overflow = col.skill_count - preview.length

              return (
                <Link
                  key={col.id}
                  href={`/collections/${slug}`}
                  className={`bg-card rounded-xl border border-border/60 overflow-hidden ${color.hover} hover:shadow-[0_4px_24px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_4px_24px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 active:scale-[0.99] transition-all duration-200 cursor-pointer group block`}
                >
                  {/* Accent top stripe */}
                  <div className="h-[3px] w-full" style={{ background: `linear-gradient(90deg, ${color.accent}, ${color.accent}60)` }} />

                  <div className="p-5">
                    {/* Icon + name + description */}
                    <div className="flex items-start gap-3 mb-4">
                      <div className={`w-9 h-9 rounded-lg ${color.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                        <FolderOpen className={`h-4 w-4 ${color.icon}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[14px] font-semibold text-foreground group-hover:text-accent transition-colors truncate">
                          {col.name}
                        </h3>
                        {col.description && col.description !== `${col.name} skills` && (
                          <p className="text-[11px] text-muted-foreground/60 mt-0.5 line-clamp-1">{col.description}</p>
                        )}
                      </div>
                    </div>

                    {/* Skill name preview */}
                    {preview.length > 0 ? (
                      <div className="mb-4 space-y-1">
                        {preview.map(s => (
                          <div key={s.slug} className="flex items-center gap-1.5">
                            <FileText className="h-3 w-3 text-muted-foreground/25 shrink-0" />
                            <span className="text-[12px] text-muted-foreground/60 truncate">{s.title}</span>
                          </div>
                        ))}
                        {overflow > 0 && (
                          <p className="text-[11px] text-muted-foreground/35 pl-4.5">+{overflow} more</p>
                        )}
                      </div>
                    ) : (
                      <div className="mb-4">
                        <p className="text-[12px] text-muted-foreground/30 italic">Empty collection</p>
                      </div>
                    )}

                    {/* Footer row */}
                    <div className="flex items-center justify-between pt-3 border-t border-border/40">
                      <span className="text-[12px] text-muted-foreground">
                        <span className="text-foreground font-semibold">{col.skill_count}</span>{' '}
                        {col.skill_count === 1 ? 'skill' : 'skills'}
                      </span>
                      <span className="text-[11px] text-muted-foreground/40 tabular-nums">{formatRelative(col.updated_at)}</span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </main>

      {newCollectionOpen && (
        <NewCollectionModal
          onClose={() => setNewCollectionOpen(false)}
          onCreated={handleCollectionCreated}
        />
      )}
    </>
  )
}
