'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import { X, Search, Loader2, Check } from 'lucide-react'
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
  const [toggling, setToggling] = useState<Set<string>>(new Set())
  // slugs added in this session (initially empty)
  const [addedSlugs, setAddedSlugs] = useState<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => { searchRef.current?.focus() }, [])

  // Skills not in this collection at open-time
  const initialAvailable = useMemo(
    () => allSkills.filter(s => !(s.collections || []).some(c => c.toLowerCase() === collectionName.toLowerCase())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Search filter (searches over all initially-available skills)
  const searchFiltered = useMemo(() => {
    if (!query.trim()) return initialAvailable
    const q = query.toLowerCase()
    return initialAvailable.filter(s =>
      s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    )
  }, [initialAvailable, query])

  // Split into two buckets: added-this-session (float to top) vs. rest
  const addedItems = searchFiltered.filter(s => addedSlugs.has(s.slug))
  const availableItems = searchFiltered.filter(s => !addedSlugs.has(s.slug))

  async function handleToggle(skill: Skill) {
    if (toggling.has(skill.slug)) return
    const isAdded = addedSlugs.has(skill.slug)
    setToggling(prev => new Set(prev).add(skill.slug))
    try {
      if (isAdded) {
        // Remove from collection
        const updated = (skill.collections || []).filter(
          c => c.toLowerCase() !== collectionName.toLowerCase()
        )
        await saveSkillEdit(skill.slug, { collections: updated })
        setAddedSlugs(prev => { const s = new Set(prev); s.delete(skill.slug); return s })
      } else {
        // Add to collection
        await saveSkillEdit(skill.slug, { collections: [...(skill.collections || []), collectionName] })
        setAddedSlugs(prev => new Set(prev).add(skill.slug))
      }
      onAdded()
    } catch {
      toast.error(isAdded ? `Failed to remove "${skill.title}"` : `Failed to add "${skill.title}"`)
    } finally {
      setToggling(prev => { const s = new Set(prev); s.delete(skill.slug); return s })
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'Enter' && availableItems.length > 0) {
      handleToggle(availableItems[0])
    }
  }

  function handleDone() {
    if (addedSlugs.size > 0) {
      toast.success(`${addedSlugs.size} skill${addedSlugs.size > 1 ? 's' : ''} added to "${collectionName}"`)
    }
    onClose()
  }

  const isEmpty = searchFiltered.length === 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-[420px] bg-card border border-border/50 sm:rounded-xl rounded-t-2xl shadow-2xl flex flex-col max-h-[88vh] sm:max-h-[68vh] mx-0 sm:mx-4 animate-in fade-in slide-in-from-bottom-3 sm:zoom-in-95 duration-200 sm:origin-center"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-foreground">
              Add skills to &ldquo;{collectionName}&rdquo;
            </p>
            {addedSlugs.size > 0 && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5 font-medium">
                {addedSlugs.size} added · click to undo
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors shrink-0 ml-3"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Search ── */}
        <div className="px-4 pb-3 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 pointer-events-none" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search skills…"
              className="w-full h-9 pl-9 pr-3 text-[13px] bg-muted/50 border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring focus:border-transparent placeholder:text-muted-foreground/40 transition-all"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* ── List ── */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {isEmpty ? (
            <div className="flex items-center justify-center py-10">
              <p className="text-[13px] text-muted-foreground/60">
                {initialAvailable.length === 0
                  ? 'All skills are already in this collection'
                  : 'No skills match your search'}
              </p>
            </div>
          ) : (
            <>
              {/* Added section — floats to top */}
              {addedItems.length > 0 && (
                <>
                  <div className="px-4 pt-2 pb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                      Added
                    </span>
                  </div>
                  {addedItems.map(skill => (
                    <SkillRow
                      key={skill.slug}
                      skill={skill}
                      state="added"
                      loading={toggling.has(skill.slug)}
                      onClick={() => {}}
                      onRemove={() => handleToggle(skill)}
                    />
                  ))}
                  {availableItems.length > 0 && (
                    <div className="mx-4 my-1.5 border-t border-border/30" />
                  )}
                </>
              )}

              {/* Available section */}
              {availableItems.length > 0 && (
                <>
                  {addedItems.length === 0 && (
                    <div className="px-4 pt-2 pb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
                        Skills
                      </span>
                    </div>
                  )}
                  {availableItems.map(skill => (
                    <SkillRow
                      key={skill.slug}
                      skill={skill}
                      state="available"
                      loading={toggling.has(skill.slug)}
                      onClick={() => handleToggle(skill)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 border-t border-border/30 px-4 py-3 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground/40 flex items-center gap-2">
            <kbd className="px-1 py-0.5 text-[10px] bg-muted border border-border/50 rounded font-mono">↵</kbd>
            add first · × to remove
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

/* ── Skill row ── */
type RowState = 'available' | 'added'
function SkillRow({ skill, state, loading, onClick, onRemove }: {
  skill: Skill
  state: RowState
  loading: boolean
  onClick: () => void
  onRemove?: () => void
}) {
  const isAdded = state === 'added'

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 ${isAdded ? '' : 'hover:bg-muted/60 cursor-pointer'} transition-colors`}
      onClick={isAdded ? undefined : onClick}
    >
      {/* Checkbox */}
      <div className={`w-[18px] h-[18px] rounded-[4px] border flex items-center justify-center shrink-0 transition-all duration-150 ${
        isAdded
          ? 'bg-emerald-500 border-emerald-500'
          : 'border-border/60 bg-transparent'
      }`}>
        {loading ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin text-white" />
        ) : isAdded ? (
          <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
        ) : null}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium truncate text-foreground">
          {skill.title}
        </p>
        {skill.description && (
          <p className="text-[11px] text-muted-foreground/50 truncate mt-0.5">{skill.description}</p>
        )}
      </div>

      {/* × remove button on added rows */}
      {isAdded && onRemove && (
        <button
          onMouseDown={e => { e.stopPropagation(); onRemove() }}
          className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/80 transition-colors shrink-0"
          title="Remove"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </button>
      )}
    </div>
  )
}
