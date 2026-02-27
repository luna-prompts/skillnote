'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { TopBar } from '@/components/layout/topbar'
import { SkillListItem } from '@/components/skills/skill-list-item'
import { SkillCard } from '@/components/skills/skill-card'
import { FilterPanel } from '@/components/filters/filter-panel'
import { Skill } from '@/lib/mock-data'
import { getSkills, syncSkillsFromApi } from '@/lib/skills-store'
import { cn } from '@/lib/utils'
import { SearchX, SlidersHorizontal, X, Sparkles } from 'lucide-react'

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
  const isFiltered = activeFilterCount > 0 || searchQuery.length > 0

  return (
    <>
      <TopBar view={view} onViewChange={setView} showViewToggle searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop Filters sidebar */}
        <aside className="hidden lg:flex lg:flex-col w-52 border-r border-border/40 shrink-0 overflow-y-auto bg-card/20">
          <div className="px-4 py-5 flex-1">
            <FilterPanel
              tags={tags}
              collections={collections}
              selectedTags={selectedTags}
              selectedCollections={selectedCollections}
              onToggleTag={toggleTag}
              onToggleCollection={toggleCollection}
            />
          </div>
          {/* Sidebar footer with keyboard hint */}
          <div className="px-4 py-3 border-t border-border/20">
            <p className="text-[10px] text-muted-foreground/20 font-mono">
              <kbd className="text-[9px] px-1 py-0.5 rounded border border-foreground/[0.06] bg-foreground/[0.02]">⌘K</kbd> to search
            </p>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          {/* Status bar */}
          <div className="px-4 sm:px-6 py-3 border-b border-border/30 bg-card/30 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <p className="text-[12px] text-muted-foreground/60 flex items-center gap-1.5">
                <span className="text-[18px] font-semibold text-foreground leading-none tabular-nums">{filtered.length}</span>
                <span className="hidden sm:inline">skill{filtered.length !== 1 ? 's' : ''}</span>
                {isFiltered && (
                  <span className="inline-flex items-center gap-1 text-accent/70 font-medium">
                    <Sparkles className="h-3 w-3" />
                    <span className="hidden sm:inline">filtered</span>
                  </span>
                )}
              </p>

              {/* Active filter chips — inline next to count */}
              {activeFilterCount > 0 && (
                <div className="flex items-center gap-1 flex-wrap min-w-0">
                  <span className="w-px h-4 bg-border/40 mx-0.5 hidden sm:block" />
                  {selectedTags.map(tag => (
                    <button
                      key={`chip-tag-${tag}`}
                      onClick={() => toggleTag(tag)}
                      className="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-md bg-accent/8 text-accent text-[11px] font-mono font-medium hover:bg-accent/15 transition-all duration-150 group/chip"
                    >
                      {tag}
                      <X className="h-3 w-3 opacity-40 group-hover/chip:opacity-100 transition-opacity" />
                    </button>
                  ))}
                  {selectedCollections.map(col => (
                    <button
                      key={`chip-col-${col}`}
                      onClick={() => toggleCollection(col)}
                      className="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-md bg-accent/8 text-accent text-[11px] font-medium hover:bg-accent/15 transition-all duration-150 group/chip"
                    >
                      {col}
                      <X className="h-3 w-3 opacity-40 group-hover/chip:opacity-100 transition-opacity" />
                    </button>
                  ))}
                  <button
                    onClick={() => { setSelectedTags([]); setSelectedCollections([]) }}
                    className="text-[10px] text-muted-foreground/30 hover:text-accent ml-0.5 transition-colors duration-200 font-medium"
                  >
                    clear
                  </button>
                </div>
              )}
            </div>

            {/* Mobile filter button */}
            <button
              onClick={() => setMobileFilterOpen(true)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all duration-200 lg:hidden min-h-[44px]',
                activeFilterCount > 0
                  ? 'bg-accent/10 text-accent border border-accent/15'
                  : 'text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.03] border border-transparent'
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Filter</span>
              {activeFilterCount > 0 && (
                <span className="ml-0.5 w-4 h-4 rounded-full bg-accent text-white text-[10px] flex items-center justify-center font-bold">{activeFilterCount}</span>
              )}
            </button>
          </div>

          {/* Skill list / grid */}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-28 px-6">
              <div className="w-14 h-14 rounded-2xl bg-foreground/[0.03] border border-foreground/[0.05] flex items-center justify-center mb-5">
                <SearchX className="h-6 w-6 text-muted-foreground/30" />
              </div>
              <p className="text-[15px] font-semibold text-foreground mb-1.5">No skills found</p>
              <p className="text-[13px] text-muted-foreground/50 text-center max-w-xs leading-relaxed">
                {searchQuery
                  ? `Nothing matches "${searchQuery}". Try adjusting your search.`
                  : 'No skills match the current filters.'}
              </p>
              {isFiltered && (
                <button
                  onClick={() => { setSelectedTags([]); setSelectedCollections([]); setSearchQuery('') }}
                  className="mt-5 text-[12px] font-semibold text-accent hover:text-accent/80 transition-colors px-4 py-2 rounded-lg bg-accent/5 hover:bg-accent/10"
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
            <div className="p-4 sm:p-5 pb-24 lg:pb-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filtered.map(skill => <SkillCard key={skill.slug} skill={skill} />)}
            </div>
          )}
        </main>
      </div>

      {/* Mobile filter bottom sheet */}
      {mobileFilterOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] lg:hidden transition-opacity duration-200"
            onClick={() => setMobileFilterOpen(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border/40 rounded-t-2xl shadow-[0_-8px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_-8px_40px_rgba(0,0,0,0.5)] max-h-[75vh] overflow-y-auto lg:hidden animate-in slide-in-from-bottom duration-200">
            {/* Sheet handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-8 h-1 rounded-full bg-foreground/10" />
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 sticky top-0 bg-card z-10">
              <h3 className="text-[13px] font-bold text-foreground tracking-tight">Filters</h3>
              <div className="flex items-center gap-3">
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => { setSelectedTags([]); setSelectedCollections([]) }}
                    className="text-[12px] text-accent font-semibold"
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
              <FilterPanel
                tags={tags}
                collections={collections}
                selectedTags={selectedTags}
                selectedCollections={selectedCollections}
                onToggleTag={toggleTag}
                onToggleCollection={toggleCollection}
              />
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
