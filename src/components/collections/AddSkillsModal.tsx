'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import { FolderOpen, X, Search, Loader2, Check, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { Skill } from '@/lib/mock-data'
import { saveSkillEdit } from '@/lib/skills-store'

type Props = {
  collectionName: string
  allSkills: Skill[]
  onClose: () => void
  onAdded: () => void
}

export function AddSkillsModal({ collectionName, allSkills, onClose, onAdded }: Props) {
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<Set<string>>(new Set())
  const [added, setAdded] = useState<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  // Skills not yet in this collection
  const available = useMemo(
    () => allSkills.filter(s => !(s.collections || []).some(c => c.toLowerCase() === collectionName.toLowerCase())),
    [allSkills, collectionName]
  )

  const filtered = useMemo(() => {
    if (!query.trim()) return available
    const q = query.toLowerCase()
    return available.filter(s => s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
  }, [available, query])

  async function handleAdd(skill: Skill) {
    if (adding.has(skill.slug) || added.has(skill.slug)) return
    setAdding(prev => new Set(prev).add(skill.slug))
    try {
      await saveSkillEdit(skill.slug, { collections: [...(skill.collections || []), collectionName] })
      setAdded(prev => new Set(prev).add(skill.slug))
      onAdded()
    } catch {
      toast.error(`Failed to add "${skill.title}"`)
    } finally {
      setAdding(prev => { const s = new Set(prev); s.delete(skill.slug); return s })
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'Enter' && filtered.length > 0) {
      const first = filtered.find(s => !added.has(s.slug) && !adding.has(s.slug))
      if (first) handleAdd(first)
    }
  }

  function handleDone() {
    if (added.size > 0) {
      toast.success(`Added ${added.size} skill${added.size > 1 ? 's' : ''} to ${collectionName}`)
    }
    onClose()
  }

  const addedCount = added.size

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-[440px] bg-card border border-border/60 sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[72vh] mx-0 sm:mx-4 animate-in fade-in slide-in-from-bottom-2 duration-200"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
              <FolderOpen className="h-4 w-4 text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground truncate">Add to &quot;{collectionName}&quot;</p>
              <p className="text-[11px] text-muted-foreground">
                {available.length === 0
                  ? 'All skills already added'
                  : `${available.length} skill${available.length > 1 ? 's' : ''} available`
                }
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0 ml-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pb-3 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search skills..."
              className="w-full h-9 pl-9 pr-3 text-[13px] bg-muted/50 border border-border/50 rounded-xl focus:outline-none focus:ring-1 focus:ring-ring focus:border-transparent placeholder:text-muted-foreground/50 transition-all"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-border/40 mx-0 shrink-0" />

        {/* Skill list */}
        <div className="overflow-y-auto flex-1 py-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-4">
              <p className="text-[13px] text-muted-foreground text-center">
                {available.length === 0
                  ? 'All skills are already in this collection.'
                  : 'No skills match your search.'}
              </p>
            </div>
          ) : (
            filtered.map(skill => {
              const isAdding = adding.has(skill.slug)
              const isAdded = added.has(skill.slug)
              return (
                <button
                  key={skill.slug}
                  onClick={() => handleAdd(skill)}
                  disabled={isAdding || isAdded}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    isAdded
                      ? 'bg-green-500/[0.06] hover:bg-green-500/[0.08]'
                      : 'hover:bg-muted/50 active:bg-muted/80'
                  } disabled:cursor-default`}
                >
                  {/* Status indicator */}
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all duration-200 ${
                    isAdded
                      ? 'bg-green-500 border-green-500'
                      : isAdding
                      ? 'border-muted-foreground/40'
                      : 'border-border/60 group-hover:border-muted-foreground/60'
                  }`}>
                    {isAdding ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                    ) : isAdded ? (
                      <Check className="h-3 w-3 text-white" strokeWidth={3} />
                    ) : (
                      <Plus className="h-2.5 w-2.5 text-muted-foreground/40" />
                    )}
                  </div>

                  {/* Skill info */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-medium truncate transition-colors ${isAdded ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}>
                      {skill.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5 leading-tight">
                      {skill.description}
                    </p>
                  </div>

                  {/* Collections count badge */}
                  {(skill.collections || []).length > 0 && (
                    <span className="text-[10px] text-muted-foreground/50 shrink-0">
                      {skill.collections!.length} {skill.collections!.length === 1 ? 'collection' : 'collections'}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="h-px bg-border/40 shrink-0" />
        <div className="px-4 py-3 flex items-center justify-between shrink-0">
          <p className="text-[12px] text-muted-foreground">
            {addedCount > 0 ? (
              <span className="text-green-600 dark:text-green-400 font-medium">
                {addedCount} skill{addedCount > 1 ? 's' : ''} added
              </span>
            ) : (
              <span>Click a skill to add it</span>
            )}
          </p>
          <button
            onClick={handleDone}
            className="h-8 px-4 rounded-lg text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90 active:scale-95 transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
