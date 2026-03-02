'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import { Plus, X, FolderOpen, Check, Search } from 'lucide-react'
import { getSkills } from '@/lib/skills-store'

type Props = {
  selected: string[]
  onChange: (selected: string[]) => void
  placeholder?: string
  /** Compact mode = used inside editor */
  compact?: boolean
}

function getAllCollections(): string[] {
  const set = new Set<string>()
  try {
    for (const s of getSkills()) {
      for (const c of s.collections || []) set.add(c)
    }
    const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
    for (const name of Object.keys(meta)) set.add(name)
  } catch {}
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

function persistCollection(name: string) {
  try {
    const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
    if (!meta[name]) {
      meta[name] = { description: '', created_at: new Date().toISOString() }
      localStorage.setItem('skillnote:collections-meta', JSON.stringify(meta))
    }
  } catch {}
}

export function CollectionPicker({ selected, onChange, placeholder, compact = false }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [allCollections, setAllCollections] = useState<string[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setAllCollections(getAllCollections()) }, [])

  // Focus search input whenever dropdown opens
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setTimeout(() => searchRef.current?.focus(), 0)
    }
  }, [open])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const available = useMemo(
    () => allCollections.filter(c => !selected.some(s => s.toLowerCase() === c.toLowerCase())),
    [allCollections, selected]
  )

  const filtered = useMemo(() => {
    if (!query.trim()) return available
    const q = query.toLowerCase()
    return available.filter(c => c.toLowerCase().includes(q))
  }, [query, available])

  const canCreate = useMemo(() => {
    const v = query.trim()
    if (!v) return false
    return !allCollections.some(c => c.toLowerCase() === v.toLowerCase()) &&
           !selected.some(c => c.toLowerCase() === v.toLowerCase())
  }, [query, allCollections, selected])

  // Flat ordered list of items for keyboard navigation
  const items: string[] = [...filtered, ...(canCreate ? ['__create__'] : [])]

  function add(item: string) {
    const name = item === '__create__' ? query.trim() : item
    if (!name) return
    if (!selected.some(c => c.toLowerCase() === name.toLowerCase())) {
      onChange([...selected, name])
      persistCollection(name)
      setAllCollections(getAllCollections())
    }
    setOpen(false)
  }

  function remove(name: string) {
    onChange(selected.filter(c => c !== name))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => (i + 1) % Math.max(items.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => (i - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items[activeIndex] !== undefined) add(items[activeIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">

      {/* ── Selected chips ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map(col => (
          <span
            key={col}
            className="group flex items-center gap-1.5 h-[26px] px-2.5 rounded-md text-[12px] font-medium bg-muted/70 text-foreground border border-border/50 shrink-0 select-none"
          >
            <FolderOpen className="h-3 w-3 text-muted-foreground/60 shrink-0" />
            {col}
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); remove(col) }}
              className="ml-0.5 text-muted-foreground/40 hover:text-foreground transition-colors"
              aria-label={`Remove ${col}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        {/* ── Add trigger ── */}
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1 h-[26px] px-2.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border border-dashed border-border/40 hover:border-border/70"
        >
          <Plus className="h-3 w-3" />
          {selected.length === 0 ? (placeholder ?? 'Add collection') : 'Add'}
        </button>
      </div>

      {/* ── Notion-style command palette ── */}
      {open && (
        <div className="absolute top-full left-0 z-[100] w-60 mt-1.5 bg-popover border border-border/60 rounded-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-left">

          {/* Search row */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
            <Search className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActiveIndex(0) }}
              onKeyDown={handleKeyDown}
              placeholder="Search or create..."
              className="flex-1 text-[13px] bg-transparent focus:outline-none placeholder:text-muted-foreground/35 text-foreground"
            />
          </div>

          {/* Section label */}
          {filtered.length > 0 && (
            <div className="px-3 pt-2 pb-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
                Collections
              </span>
            </div>
          )}

          {/* Items */}
          <div className="max-h-52 overflow-y-auto py-1">
            {items.length === 0 && (
              <div className="px-3 py-4 text-[12px] text-muted-foreground/50 text-center">
                {allCollections.length === 0 ? 'No collections yet' : 'No matches'}
              </div>
            )}

            {filtered.map((col, idx) => {
              const isActive = idx === activeIndex
              return (
                <button
                  key={col}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); add(col) }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-none text-[13px] ${
                    isActive ? 'bg-muted/70 text-foreground' : 'text-foreground/80'
                  }`}
                >
                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                  <span className="flex-1 truncate">{col}</span>
                </button>
              )
            })}

            {canCreate && (() => {
              const idx = filtered.length
              const isActive = idx === activeIndex
              return (
                <>
                  {filtered.length > 0 && <div className="mx-3 my-1 border-t border-border/30" />}
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); add('__create__') }}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-none text-[13px] ${
                      isActive ? 'bg-muted/70 text-foreground' : 'text-foreground/80'
                    }`}
                  >
                    <div className="w-[18px] h-[18px] rounded bg-accent/15 flex items-center justify-center shrink-0">
                      <Plus className="h-2.5 w-2.5 text-accent" />
                    </div>
                    <span>
                      Create{' '}
                      <span className="font-medium text-accent">&ldquo;{query.trim()}&rdquo;</span>
                    </span>
                  </button>
                </>
              )
            })()}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-1.5 border-t border-border/20 flex items-center gap-3">
            <span className="text-[10px] text-muted-foreground/30">↑↓ navigate</span>
            <span className="text-[10px] text-muted-foreground/30">↵ select</span>
            <span className="text-[10px] text-muted-foreground/30">esc close</span>
          </div>
        </div>
      )}
    </div>
  )
}
