'use client'
import Link from 'next/link'
import { TopBar } from '@/components/layout/topbar'
import { FolderOpen, Plus, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEffect, useMemo, useState } from 'react'
import { getSkills, syncSkillsFromApi } from '@/lib/skills-store'
import { deriveCollections } from '@/lib/derived'
import { NewCollectionModal } from '@/components/collections/NewCollectionModal'
import type { Skill } from '@/lib/mock-data'

function getSkillsForCollection(skills: Skill[], name: string): Skill[] {
  return skills.filter(s =>
    (s.collections || []).some(c => c.toLowerCase() === name.toLowerCase())
  )
}

export default function CollectionsPage() {
  const [skills, setSkills] = useState(getSkills())
  const [newCollectionOpen, setNewCollectionOpen] = useState(false)

  useEffect(() => {
    syncSkillsFromApi().then(setSkills).catch(() => {})
  }, [])

  const collections = useMemo(() => deriveCollections(skills), [skills])

  function handleCollectionCreated() {
    setSkills(s => [...s])
    setNewCollectionOpen(false)
  }

  return (
    <>
      <TopBar />
      <main className="flex-1 p-4 sm:p-6 overflow-auto">

        {/* Page header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Collections</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              {collections.length === 0
                ? 'No collections yet'
                : `${collections.length} collection${collections.length === 1 ? '' : 's'}`}
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

        {collections.length === 0 ? (
          /* ── Empty state ── */
          <div className="flex flex-col items-center justify-center py-28 px-6">
            <div className="w-16 h-16 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center mb-5">
              <FolderOpen className="h-8 w-8 text-muted-foreground/25" />
            </div>
            <p className="text-[15px] font-semibold text-foreground mb-2">No collections yet</p>
            <p className="text-[13px] text-muted-foreground/60 text-center max-w-[220px] mb-6 leading-relaxed">
              Group your skills to keep things organised and easy to find.
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
          /* ── Collection grid ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-24 lg:pb-6">
            {collections.map(col => {
              const slug = col.name.toLowerCase().replace(/\s+/g, '-')
              const preview = getSkillsForCollection(skills, col.name).slice(0, 5)
              const overflow = col.skill_count - preview.length
              const initial = col.name.charAt(0).toUpperCase()
              const hasDesc = col.description && col.description !== `${col.name} skills`

              return (
                <Link
                  key={col.id}
                  href={`/collections/${slug}`}
                  className="group relative bg-card border border-border/40 rounded-2xl overflow-hidden hover:border-border/80 hover:shadow-lg dark:hover:shadow-black/40 transition-all duration-200 flex flex-col"
                >
                  {/* Card body */}
                  <div className="flex-1 p-5">

                    {/* Avatar + name */}
                    <div className="flex items-start gap-3.5 mb-4">
                      <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center shrink-0 text-[18px] font-bold text-foreground/30 select-none group-hover:text-foreground/50 transition-colors">
                        {initial}
                      </div>
                      <div className="min-w-0 flex-1 pt-1">
                        <h3 className="text-[14px] font-semibold text-foreground group-hover:text-accent transition-colors truncate">
                          {col.name}
                        </h3>
                        {hasDesc && (
                          <p className="text-[11px] text-muted-foreground/50 mt-0.5 line-clamp-2 leading-relaxed">
                            {col.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Skill chips */}
                    {preview.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {preview.map(s => (
                          <span
                            key={s.slug}
                            className="inline-flex items-center h-6 px-2.5 rounded-md text-[11px] text-muted-foreground/70 bg-muted/70 truncate max-w-[140px]"
                          >
                            {s.title}
                          </span>
                        ))}
                        {overflow > 0 && (
                          <span className="inline-flex items-center h-6 px-2 rounded-md text-[11px] text-muted-foreground/40 bg-muted/40">
                            +{overflow}
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-[12px] text-muted-foreground/30 italic">No skills yet</p>
                    )}
                  </div>

                  {/* Card footer */}
                  <div className="px-5 py-3 border-t border-border/30 flex items-center justify-between bg-muted/20">
                    <span className="text-[11px] text-muted-foreground/60">
                      <span className="font-semibold text-foreground/60">{col.skill_count}</span>{' '}
                      {col.skill_count === 1 ? 'skill' : 'skills'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <ArrowRight className="h-3 w-3 text-muted-foreground/20 group-hover:text-muted-foreground/60 group-hover:translate-x-0.5 transition-all duration-150" />
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
