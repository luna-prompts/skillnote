'use client'
import Link from 'next/link'
import { TopBar } from '@/components/layout/topbar'
import { FolderOpen, Plus, ArrowRight, Info, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getSkills, syncSkillsFromApi } from '@/lib/skills-store'
import { deriveCollectionsFromApi, collectionSlug } from '@/lib/derived'
import { createCollectionApi, fetchCollectionsApi, type CollectionListItem } from '@/lib/api/collections'
import { NewCollectionModal } from '@/components/collections/NewCollectionModal'
import type { Skill } from '@/lib/mock-data'

function getSkillsForCollection(skills: Skill[], name: string): Skill[] {
  return skills.filter(s =>
    (s.collections || []).some(c => c.toLowerCase() === name.toLowerCase())
  )
}

export default function CollectionsPage() {
  const [skills, setSkills] = useState(getSkills())
  const [apiCollections, setApiCollections] = useState<CollectionListItem[]>([])
  const [newCollectionOpen, setNewCollectionOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // One-shot migration: push stale localStorage-meta entries to the API.
  // Guard prevents concurrent runs (React StrictMode, double page load).
  const migratingRef = useRef(false)
  async function migrateLocalStorageCollections(apiNames: Set<string>) {
    if (migratingRef.current) return
    migratingRef.current = true
    try {
      let meta: Record<string, { description: string; created_at: string }>
      try {
        meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
      } catch {
        return
      }
      const toMigrate = Object.entries(meta).filter(([name]) => !apiNames.has(name))
      if (toMigrate.length === 0) return

      const succeeded: string[] = []
      for (const [name, data] of toMigrate) {
        try {
          await createCollectionApi(name, data.description || '')
          succeeded.push(name)
        } catch {
          // Leave in localStorage; try again next page load
        }
      }
      if (succeeded.length === 0) return

      // Remove migrated entries from localStorage
      const remaining = { ...meta }
      for (const name of succeeded) delete remaining[name]
      localStorage.setItem('skillnote:collections-meta', JSON.stringify(remaining))

      // Re-fetch so UI reflects migrated collections
      try {
        const fresh = await fetchCollectionsApi()
        setApiCollections(fresh)
      } catch {}
    } finally {
      migratingRef.current = false
    }
  }

  async function loadCollections() {
    setLoadError(null)
    setLoading(true)
    try {
      const cols = await fetchCollectionsApi()
      setApiCollections(cols)
      await migrateLocalStorageCollections(new Set(cols.map(c => c.name)))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load collections')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    syncSkillsFromApi().then(setSkills).catch(() => {})
    loadCollections()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const collections = useMemo(
    () => deriveCollectionsFromApi(skills, apiCollections),
    [skills, apiCollections],
  )

  const filteredCollections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return collections
    return collections.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.description || '').toLowerCase().includes(q),
    )
  }, [collections, searchQuery])

  async function handleCollectionCreated() {
    setSkills(s => [...s])
    try {
      const fresh = await fetchCollectionsApi()
      setApiCollections(fresh)
    } catch {}
    setNewCollectionOpen(false)
  }

  return (
    <>
      <TopBar
        variant="collections"
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onNewCollection={() => setNewCollectionOpen(true)}
      />
      <main className="flex-1 p-4 sm:p-6 overflow-auto">

        {/* Compact subheader: count + cap tooltip. Title + New lives in TopBar. */}
        <div className="mb-5 flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <span className="tabular-nums">
            {collections.length === 0
              ? 'No collections yet'
              : `${collections.length} collection${collections.length === 1 ? '' : 's'}`}
          </span>
          {collections.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Why 15 skills per collection?"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/50 hover:bg-muted hover:text-foreground"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[300px] text-[11.5px] leading-relaxed">
                  Collections group skills by purpose. Each is capped at{' '}
                  <span className="font-semibold">15 skills</span>{' '}
                  so Claude Code&apos;s context stays efficient and descriptions don&apos;t get
                  truncated. Split large installs into multiple themed collections.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Error banner — shown when API fetch fails */}
        {loadError && !loading && (
          <div className="mb-6 flex items-start gap-2.5 px-4 py-3 rounded-lg bg-destructive/5 border border-destructive/20">
            <Info className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] text-destructive leading-relaxed">
                {loadError}
              </p>
              <button
                onClick={loadCollections}
                className="mt-1.5 text-[11px] font-medium text-destructive hover:underline"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {loading && collections.length === 0 ? (
          /* ── Loading skeleton ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-card border border-border/40 rounded-2xl overflow-hidden animate-pulse">
                <div className="p-5">
                  <div className="flex items-start gap-3.5 mb-4">
                    <div className="w-11 h-11 rounded-xl bg-muted/60" />
                    <div className="flex-1 pt-1 space-y-2">
                      <div className="h-3.5 w-28 bg-muted/60 rounded" />
                      <div className="h-2.5 w-40 bg-muted/40 rounded" />
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <div className="h-6 w-20 bg-muted/50 rounded-md" />
                    <div className="h-6 w-16 bg-muted/50 rounded-md" />
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-border/30 bg-muted/20">
                  <div className="h-1 w-full bg-border/40 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : collections.length === 0 ? (
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
        ) : filteredCollections.length === 0 ? (
          /* ── No search results ── */
          <div className="flex flex-col items-center justify-center py-20 px-6">
            <Search className="h-8 w-8 text-muted-foreground/25 mb-3" />
            <p className="text-[13px] text-muted-foreground/70">
              No collections match &ldquo;{searchQuery}&rdquo;
            </p>
            <button
              onClick={() => setSearchQuery('')}
              className="mt-3 text-[12px] text-accent hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          /* ── Collection grid ── */
          <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-24 lg:pb-6">
            {filteredCollections.map(col => {
              const slug = collectionSlug(col.name)
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
                  <div className="px-5 py-3 border-t border-border/30 flex flex-col gap-2 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <span className={`text-[11px] tabular-nums ${col.skill_count >= 15 ? 'text-red-500' : col.skill_count >= 12 ? 'text-amber-500' : 'text-muted-foreground/60'}`}>
                        <span className="font-semibold">{col.skill_count}</span>
                        {' / 15 skills'}
                      </span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/20 group-hover:text-muted-foreground/60 group-hover:translate-x-0.5 transition-all duration-150" />
                    </div>
                    {/* Progress bar */}
                    <div className="h-1 w-full rounded-full bg-border/40 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${col.skill_count >= 15 ? 'bg-red-500' : col.skill_count >= 12 ? 'bg-amber-500' : 'bg-accent/60'}`}
                        style={{ width: `${Math.min((col.skill_count / 15) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
          <div className="mt-8 text-center text-[13px] text-muted-foreground pb-8 lg:pb-0">
            Looking for more?{' '}
            <Link className="text-foreground hover:underline" href="/marketplace">
              Install from a marketplace →
            </Link>
          </div>
          </>
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
