'use client'
import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDown, Search } from 'lucide-react'
type FilterItem = { id: string; name: string; skill_count: number }

interface FilterSectionProps<T extends { id: string; name: string; skill_count: number }> {
  label: string
  items: T[]
  selected: string[]
  onToggle: (name: string) => void
  defaultVisible: number
  searchThreshold: number
  mono?: boolean
}

function FilterSection<T extends { id: string; name: string; skill_count: number }>({
  label,
  items,
  selected,
  onToggle,
  defaultVisible,
  searchThreshold,
  mono,
}: FilterSectionProps<T>) {
  const [expanded, setExpanded] = useState(false)
  const [search, setSearch] = useState('')

  const sorted = useMemo(
    () => [...items].sort((a, b) => b.skill_count - a.skill_count),
    [items]
  )

  const maxCount = useMemo(() => Math.max(...sorted.map(i => i.skill_count), 1), [sorted])

  const filtered = useMemo(() => {
    if (!search) return sorted
    const q = search.toLowerCase()
    return sorted.filter(item => item.name.toLowerCase().includes(q))
  }, [sorted, search])

  const visibleItems = useMemo(() => {
    if (expanded) return filtered
    const topN = sorted.slice(0, defaultVisible)
    const topNames = new Set(topN.map(i => i.name))
    const activeOutside = sorted.filter(i => selected.includes(i.name) && !topNames.has(i.name))
    return [...topN, ...activeOutside]
  }, [expanded, filtered, sorted, defaultVisible, selected])

  const hasMore = sorted.length > defaultVisible
  const showSearch = expanded && sorted.length > searchThreshold

  return (
    <div className="mb-6">
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-2 w-full px-2 mb-2.5 group"
      >
        <span className="text-[10px] font-bold text-foreground/40 uppercase tracking-[0.15em]">
          {label}
        </span>
        <span className="text-[10px] font-mono text-foreground/20">{sorted.length}</span>
        <ChevronDown
          className={cn(
            'h-2.5 w-2.5 text-foreground/20 ml-auto transition-transform duration-300 ease-out group-hover:text-foreground/40',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {showSearch && (
        <div className="relative px-2 mb-2">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/30" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter..."
            className="w-full h-7 pl-7 pr-2 text-[11px] rounded-lg bg-foreground/[0.03] border border-foreground/[0.06] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-accent/40 focus:bg-foreground/[0.05] transition-all"
          />
        </div>
      )}

      <div className="space-y-0.5">
        {visibleItems.map(item => {
          const active = selected.includes(item.name)
          const barWidth = Math.max((item.skill_count / maxCount) * 100, 8)
          return (
            <button
              key={item.id}
              onClick={() => onToggle(item.name)}
              className={cn(
                'w-full flex items-center gap-2.5 py-1.5 px-2 rounded-lg text-left transition-all duration-200 relative group/item',
                active
                  ? 'bg-accent/10 text-accent'
                  : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]'
              )}
            >
              <span
                className={cn(
                  'w-1 h-1 rounded-full shrink-0 transition-all duration-200',
                  active ? 'bg-accent scale-150' : 'bg-foreground/15 group-hover/item:bg-foreground/30'
                )}
              />
              <span className={cn('flex-1 text-[12px] leading-tight', mono && 'font-mono')}>
                {item.name}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-8 h-[3px] rounded-full bg-foreground/[0.04] overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-300',
                      active ? 'bg-accent/50' : 'bg-foreground/10'
                    )}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <span className={cn(
                  'text-[10px] tabular-nums w-4 text-right font-mono transition-colors',
                  active ? 'text-accent/70' : 'text-foreground/20'
                )}>
                  {item.skill_count}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {hasMore && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full text-left px-2 pt-1.5 text-[10px] font-medium text-foreground/25 hover:text-accent transition-colors duration-200"
        >
          + {sorted.length - defaultVisible} more
        </button>
      )}
    </div>
  )
}

interface FilterPanelProps {
  collections: FilterItem[]
  selectedCollections: string[]
  onToggleCollection: (name: string) => void
}

export function FilterPanel({
  collections,
  selectedCollections,
  onToggleCollection,
}: FilterPanelProps) {
  return (
    <>
      <FilterSection
        label="Collections"
        items={collections}
        selected={selectedCollections}
        onToggle={onToggleCollection}
        defaultVisible={5}
        searchThreshold={8}
      />
    </>
  )
}
