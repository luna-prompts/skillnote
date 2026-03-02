'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import { Plus, X, FolderOpen, Check } from 'lucide-react'
import { getSkills } from '@/lib/skills-store'

type Props = {
  selected: string[]
  onChange: (selected: string[]) => void
  placeholder?: string
  /** Compact mode = used inside editor (no suggestions row below) */
  compact?: boolean
}

/** Returns all unique collection names from localStorage (skills + meta) */
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

export function CollectionPicker({ selected, onChange, placeholder, compact = false }: Props) {
  const [inputVal, setInputVal] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [allCollections, setAllCollections] = useState<string[]>([])

  // Load on mount (client-only)
  useEffect(() => {
    setAllCollections(getAllCollections())
  }, [])

  const available = useMemo(
    () => allCollections.filter(c => !selected.some(s => s.toLowerCase() === c.toLowerCase())),
    [allCollections, selected]
  )

  const suggestions = useMemo(() => {
    if (!inputVal.trim()) return available
    const q = inputVal.toLowerCase()
    return available.filter(c => c.toLowerCase().includes(q))
  }, [inputVal, available])

  const canCreate = useMemo(() => {
    const v = inputVal.trim()
    if (!v) return false
    return !allCollections.some(c => c.toLowerCase() === v.toLowerCase()) &&
           !selected.some(c => c.toLowerCase() === v.toLowerCase())
  }, [inputVal, allCollections, selected])

  function add(name: string) {
    if (!selected.some(c => c.toLowerCase() === name.toLowerCase())) {
      onChange([...selected, name])
      // Persist to collections meta so empty collections show up
      try {
        const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
        if (!meta[name]) {
          meta[name] = { description: '', created_at: new Date().toISOString() }
          localStorage.setItem('skillnote:collections-meta', JSON.stringify(meta))
        }
      } catch {}
      setAllCollections(getAllCollections())
    }
    setInputVal('')
    setOpen(false)
    inputRef.current?.focus()
  }

  function remove(name: string) {
    onChange(selected.filter(c => c !== name))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (suggestions.length > 0) { add(suggestions[0]); return }
      if (canCreate) { add(inputVal.trim()); return }
    }
    if (e.key === 'Backspace' && !inputVal && selected.length > 0) {
      remove(selected[selected.length - 1])
    }
    if (e.key === 'Escape') { setOpen(false); setInputVal('') }
    if (e.key === 'ArrowDown' && !open) setOpen(true)
  }

  const showSuggestions = open && (suggestions.length > 0 || canCreate)

  return (
    <div className="relative">
      {/* Selected chips + input row */}
      <div
        className="flex flex-wrap items-center gap-1.5 min-h-9 px-2.5 py-1.5 bg-muted/50 border border-border/50 rounded-xl focus-within:ring-1 focus-within:ring-ring focus-within:border-transparent transition-all cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {selected.map(col => (
          <span
            key={col}
            className="flex items-center gap-1 h-5 px-2 rounded-full text-[11px] font-medium bg-accent/10 text-accent border border-accent/20 shrink-0"
          >
            <FolderOpen className="h-2.5 w-2.5 shrink-0" />
            {col}
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); remove(col) }}
              className="hover:opacity-60 transition-opacity"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={inputVal}
          onChange={e => { setInputVal(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={handleKeyDown}
          placeholder={selected.length === 0 ? (placeholder ?? 'Add to collection...') : ''}
          className="flex-1 min-w-[120px] text-[13px] bg-transparent focus:outline-none placeholder:text-muted-foreground/50 py-0.5"
        />
      </div>

      {/* Dropdown */}
      {showSuggestions && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-popover border border-border/60 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100">
          <div className="max-h-48 overflow-y-auto py-1">
            {suggestions.map(col => (
              <button
                key={col}
                type="button"
                onMouseDown={e => { e.preventDefault(); add(col) }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/60 transition-colors"
              >
                <FolderOpen className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                <span className="text-[13px] text-foreground flex-1">{col}</span>
                <Check className="h-3 w-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100" />
              </button>
            ))}
            {canCreate && (
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); add(inputVal.trim()) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/60 transition-colors ${suggestions.length > 0 ? 'border-t border-border/40' : ''}`}
              >
                <div className="w-5 h-5 rounded-md bg-accent/10 flex items-center justify-center shrink-0">
                  <Plus className="h-3 w-3 text-accent" />
                </div>
                <span className="text-[13px] text-foreground">
                  Create <span className="font-medium text-accent">&quot;{inputVal.trim()}&quot;</span>
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Quick-pick chips (shown when input is empty and not compact) */}
      {!compact && !open && available.length > 0 && selected.length < available.length && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {available.slice(0, 6).map(col => (
            <button
              key={col}
              type="button"
              onClick={() => add(col)}
              className="h-6 px-2.5 rounded-full text-[11px] border border-border/50 text-muted-foreground hover:text-foreground hover:border-accent/40 hover:bg-accent/5 transition-all active:scale-95"
            >
              {col}
            </button>
          ))}
          {available.length > 6 && (
            <span className="h-6 px-2 text-[11px] text-muted-foreground/50 flex items-center">
              +{available.length - 6} more
            </span>
          )}
        </div>
      )}
    </div>
  )
}
