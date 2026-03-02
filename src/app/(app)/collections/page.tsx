'use client'
import Link from 'next/link'
import { TopBar } from '@/components/layout/topbar'
import { FolderOpen, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatRelative } from '@/lib/format'
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
        <div className="flex items-center justify-between mb-6">
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
            <div className="w-14 h-14 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center mb-5">
              <FolderOpen className="h-7 w-7 text-muted-foreground/30" />
            </div>
            <p className="text-[15px] font-semibold text-foreground mb-2">No collections yet</p>
            <p className="text-[13px] text-muted-foreground/70 text-center max-w-[240px] mb-6 leading-relaxed">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-24 lg:pb-0">
            {collections.map(col => {
              const slug = col.name.toLowerCase().replace(/\s+/g, '-')
              const preview = getSkillsForCollection(skills, col.name).slice(0, 4)
              const overflow = col.skill_count - preview.length
              const initial = col.name.charAt(0).toUpperCase()
              const hasDesc = col.description && col.description !== `${col.name} skills`

              return (
                <Link
                  key={col.id}
                  href={`/collections/${slug}`}
                  className="group bg-card border border-border/50 rounded-xl overflow-hidden hover:border-border hover:shadow-md dark:hover:shadow-black/30 transition-all duration-200 cursor-pointer block"
                >
                  <div className="p-4">
                    {/* Icon + title row */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0 text-[15px] font-semibold text-foreground/60 select-none">
                        {initial}
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <h3 className="text-[14px] font-semibold text-foreground group-hover:text-accent transition-colors truncate leading-snug">
                          {col.name}
                        </h3>
                        {hasDesc && (
                          <p className="text-[11px] text-muted-foreground/60 mt-0.5 line-clamp-1 leading-snug">
                            {col.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Skill preview */}
                    {preview.length > 0 ? (
                      <div className="mb-3 space-y-1">
                        {preview.map(s => (
                          <p key={s.slug} className="text-[12px] text-muted-foreground/55 truncate font-mono">
                            {s.title}
                          </p>
                        ))}
                        {overflow > 0 && (
                          <p className="text-[11px] text-muted-foreground/35">
                            +{overflow} more
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[12px] text-muted-foreground/30 italic mb-3">
                        No skills yet
                      </p>
                    )}

                    {/* Footer */}
                    <div className="pt-2.5 border-t border-border/30 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground/60">
                        <span className="font-medium text-foreground/70">{col.skill_count}</span>{' '}
                        {col.skill_count === 1 ? 'skill' : 'skills'}
                      </span>
                      <span className="text-[11px] text-muted-foreground/35 tabular-nums">
                        {formatRelative(col.updated_at)}
                      </span>
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
