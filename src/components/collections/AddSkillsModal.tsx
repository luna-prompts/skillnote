'use client'
import { useState, useMemo } from 'react'
import { Plus, X, Search, Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

  const available = useMemo(() =>
    allSkills.filter(s => !(s.collections || []).some(c => c.toLowerCase() === collectionName.toLowerCase())),
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
      const updatedCollections = [...(skill.collections || []), collectionName]
      await saveSkillEdit(skill.slug, { collections: updatedCollections })
      setAdded(prev => new Set(prev).add(skill.slug))
      toast.success(`"${skill.title}" added to ${collectionName}`)
      onAdded()
    } catch {
      toast.error(`Failed to add "${skill.title}"`)
    } finally {
      setAdding(prev => { const s = new Set(prev); s.delete(skill.slug); return s })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl overflow-hidden mx-4 flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 shrink-0">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Plus className="h-4 w-4 text-muted-foreground" />
            Add Skills to &quot;{collectionName}&quot;
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-border/60 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search skills..."
              className="w-full h-9 pl-8 pr-3 text-[13px] bg-muted/60 border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/60"
            />
          </div>
        </div>

        {/* Skill list */}
        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-[13px] text-muted-foreground">
                {available.length === 0 ? 'All skills are already in this collection.' : 'No skills match your search.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {filtered.map(skill => {
                const isAdding = adding.has(skill.slug)
                const isAdded = added.has(skill.slug)
                return (
                  <li key={skill.slug} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">{skill.title}</p>
                      <p className="text-[12px] text-muted-foreground truncate mt-0.5">{skill.description}</p>
                    </div>
                    <button
                      onClick={() => handleAdd(skill)}
                      disabled={isAdding || isAdded}
                      className="shrink-0 h-7 px-3 rounded-md text-[12px] font-medium flex items-center gap-1.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed border border-border/60 hover:bg-accent/10 hover:border-accent/40"
                    >
                      {isAdding ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : isAdded ? (
                        <><Check className="h-3 w-3 text-green-500" /> Added</>
                      ) : (
                        <><Plus className="h-3 w-3" /> Add</>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border/60 shrink-0 flex justify-end">
          <Button variant="outline" size="sm" className="h-8 text-[13px]" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  )
}
