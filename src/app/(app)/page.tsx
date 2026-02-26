'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { TopBar } from '@/components/layout/topbar'
import { SkillListItem } from '@/components/skills/skill-list-item'
import { SkillCard } from '@/components/skills/skill-card'
import { Skill } from '@/lib/mock-data'
import { getSkills, syncSkillsFromApi } from '@/lib/skills-store'
import { cn } from '@/lib/utils'
import { SearchX, SlidersHorizontal, X } from 'lucide-react'

function SkillsPageInner() {
  const searchParams = useSearchParams()
  const tagFromUrl = searchParams.get('tag')

  const [view, setView] = useState<'list' | 'grid'>('list')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedCollections, setSelectedCollections] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)
  const [skills, setSkills] = useState<Skill[]>([])

  // Load skills on mount + re-sync on focus and when skills-store changes
  useEffect(() => {
    const sync = () => syncSkillsFromApi().then(setSkills).catch(() => {})
    const refresh = () => setSkills(getSkills())
    setSkills(getSkills())
    sync()
    window.addEventListener('focus', sync)
    window.addEventListener('skillnote:skills-changed', refresh)
    return () => {
      window.removeEventListener('focus', sync)
      window.removeEventListener('skillnote:skills-changed', refresh)
    }
  }, [])

  const tagCounts = skills.reduce<Record<string, number>>((acc, s) => {
    for (const t of s.tags || []) acc[t] = (acc[t] || 0) + 1
    return acc
  }, {})
  const collectionCounts = skills.reduce<Record<string, number>>((acc, s) => {
    for (const c of s.collections || []) acc[c] = (acc[c] || 0) + 1
    return acc
  }, {})
  const tags = Object.entries(tagCounts).map(([name, count], i) => ({ id: String(i + 1), name, skill_count: count }))
  const collections = Object.entries(collectionCounts).map(([name, count], i) => ({ id: String(i + 1), name, skill_count: count }))

  useEffect(() => {
    if (tagFromUrl && tags.some(t => t.name === tagFromUrl)) {
      setSelectedTags([tagFromUrl])
    }
  }, [tagFromUrl, tags])

  const filtered = skills.filter(s => {
    if (selectedTags.length && !selectedTags.some(t => s.tags.includes(t))) return false
    if (selectedCollections.length && !selectedCollections.some(c => s.collections.includes(c))) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (!s.title.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q) && !s.tags.some(t => t.toLowerCase().includes(q))) return false
    }
    return true
  })

  const toggleTag = (tag: string) =>
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  const toggleCollection = (name: string) =>
    setSelectedCollections(prev => prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name])

  const activeFilterCount = selectedTags.length + selectedCollections.length

  const filterContent = (
    <>
      <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest px-2 mb-2">Tags</p>
      <div className="space-y-px mb-5">
        {tags.map(tag => {
          const active = selectedTags.includes(tag.name)
          return (
            <button
              key={tag.id}
              onClick={() => toggleTag(tag.name)}
              className={cn(
                'w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-left transition-colors',
                active
                  ? 'bg-accent/10 text-accent'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0 transition-colors', active ? 'bg-accent' : 'bg-muted-foreground/30')} />
              <span className="flex-1 text-[12px] font-mono">{tag.name}</span>
              <span className="text-[11px] tabular-nums opacity-50">{tag.skill_count}</span>
            </button>
          )
        })}
      </div>

      <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest px-2 mb-2">Collections</p>
      <div className="space-y-px">
        {collections.map(col => {
          const active = selectedCollections.includes(col.name)
          return (
            <button
              key={col.id}
              onClick={() => toggleCollection(col.name)}
              className={cn(
                'w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-left transition-colors',
                active
                  ? 'bg-accent/10 text-accent'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0 transition-colors', active ? 'bg-accent' : 'bg-muted-foreground/30')} />
              <span className="flex-1 text-[12px]">{col.name}</span>
              <span className="text-[11px] tabular-nums opacity-50">{col.skill_count}</span>
            </button>
          )
        })}
      </div>
    </>
  )

  return (
    <>
      <TopBar view={view} onViewChange={setView} showViewToggle searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop Filters sidebar */}
        <aside className="hidden lg:block w-48 border-r border-border/60 px-3 py-5 shrink-0 overflow-y-auto bg-card/30">
          {filterContent}
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          <div className="px-4 sm:px-5 py-2.5 border-b border-border/40 bg-muted/20 flex items-center justify-between">
            <p className="text-[12px] text-muted-foreground">
              <span className="font-medium text-foreground">{filtered.length}</span> skill{filtered.length !== 1 ? 's' : ''}
              {(activeFilterCount + searchQuery.length) > 0 && <span className="text-accent"> · filtered</span>}
            </p>
            {/* Mobile filter button */}
            <button
              onClick={() => setMobileFilterOpen(true)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors lg:hidden min-h-[44px]',
                activeFilterCount > 0 ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filter
              {activeFilterCount > 0 && (
                <span className="ml-1 w-4 h-4 rounded-full bg-accent text-white text-[10px] flex items-center justify-center">{activeFilterCount}</span>
              )}
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 px-6">
              <div className="w-12 h-12 rounded-xl bg-muted/80 flex items-center justify-center mb-4">
                <SearchX className="h-6 w-6 text-muted-foreground/60" />
              </div>
              <p className="text-[14px] font-medium text-foreground mb-1">No skills found</p>
              <p className="text-[13px] text-muted-foreground text-center max-w-xs">
                {searchQuery
                  ? `No skills match "${searchQuery}". Try a different search term.`
                  : 'No skills match the current filters. Try adjusting your tag or collection selection.'}
              </p>
              {(activeFilterCount + searchQuery.length) > 0 && (
                <button
                  onClick={() => { setSelectedTags([]); setSelectedCollections([]); setSearchQuery('') }}
                  className="mt-4 text-[13px] font-medium text-accent hover:text-accent/80 transition-colors"
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : view === 'list' ? (
            <div className="pb-24 lg:pb-0">
              {filtered.map(skill => <SkillListItem key={skill.slug} skill={skill} />)}
            </div>
          ) : (
            <div className="p-4 sm:p-5 pb-24 lg:pb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map(skill => <SkillCard key={skill.slug} skill={skill} />)}
            </div>
          )}
        </main>
      </div>

      {/* Mobile filter bottom sheet */}
      {mobileFilterOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileFilterOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border rounded-t-2xl shadow-2xl max-h-[70vh] overflow-y-auto lg:hidden animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/60 sticky top-0 bg-card z-10">
              <h3 className="text-sm font-semibold text-foreground">Filters</h3>
              <div className="flex items-center gap-3">
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => { setSelectedTags([]); setSelectedCollections([]) }}
                    className="text-[12px] text-accent font-medium"
                  >
                    Clear all
                  </button>
                )}
                <button onClick={() => setMobileFilterOpen(false)} className="p-1 text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Close filters">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="px-5 py-4">
              {filterContent}
            </div>
          </div>
        </>
      )}
    </>
  )
}

export default function SkillsPage() {
  return (
    <Suspense>
      <SkillsPageInner />
    </Suspense>
  )
}
