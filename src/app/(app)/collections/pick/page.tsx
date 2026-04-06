'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { Search, Check, Copy, FolderOpen, Loader2 } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { resolvePickSession } from '@/lib/api/sessions'
import { getApiBaseUrl } from '@/lib/api/client'
import { cn } from '@/lib/utils'

type Collection = { name: string; count: number }

export default function PickPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
      <PickContent />
    </Suspense>
  )
}

function PickContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [collections, setCollections] = useState<Collection[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  // Fetch collections
  useEffect(() => {
    const api = getApiBaseUrl()
    fetch(`${api}/v1/collections`)
      .then(r => r.json())
      .then((cols: Collection[]) => {
        setCollections(cols.sort((a, b) => b.count - a.count))
        setLoading(false)
      })
      .catch(() => {
        setError('Could not load collections')
        setLoading(false)
      })
  }, [])

  const filtered = useMemo(
    () => collections.filter(c => c.name.toLowerCase().includes(search.toLowerCase())),
    [collections, search]
  )

  const toggle = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleConfirm = async () => {
    if (!token || selected.size === 0) return
    setSubmitting(true)
    try {
      await resolvePickSession(token, Array.from(selected))
      setDone(true)
    } catch {
      setError('Failed to save selection. The session may have expired.')
    } finally {
      setSubmitting(false)
    }
  }

  const copyName = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name)
      setCopied(name)
      setTimeout(() => setCopied(null), 2000)
    } catch {}
  }

  if (!token) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Missing session token. Open this page from Claude Code.</p>
      </div>
    )
  }

  if (done) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
            <Check className="h-6 w-6 text-emerald-500" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Selection sent!</h2>
          <p className="text-[13px] text-muted-foreground">
            Return to Claude Code — your collections are being applied.
          </p>
          <p className="text-[12px] text-muted-foreground/60 mt-2">
            Selected: {Array.from(selected).join(', ')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-foreground">Pick Collections</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Select which collections to sync for your project. Keep 12-15 skills per collection for best performance.
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search collections..."
            className="w-full pl-10 pr-4 py-2.5 text-[14px] bg-muted/30 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-muted-foreground/40"
            autoFocus
          />
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-[13px] text-destructive">
            {error}
          </div>
        )}

        {/* Collection Grid */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <FolderOpen className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-[13px] text-muted-foreground">
              {search ? 'No collections match your search.' : 'No collections yet.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {filtered.map(col => {
              const isSelected = selected.has(col.name)
              return (
                <button
                  key={col.name}
                  type="button"
                  onClick={() => toggle(col.name)}
                  className={cn(
                    'flex items-center gap-3 p-4 rounded-xl border text-left transition-all',
                    isSelected
                      ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                      : 'border-border/40 bg-card hover:border-border/80 hover:bg-muted/20'
                  )}
                >
                  {/* Checkbox */}
                  <div className={cn(
                    'w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors',
                    isSelected ? 'bg-accent border-accent' : 'border-muted-foreground/30'
                  )}>
                    {isSelected && <Check className="h-3 w-3 text-white" />}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-foreground truncate">{col.name}</p>
                    <p className="text-[12px] text-muted-foreground">{col.count} skill{col.count !== 1 ? 's' : ''}</p>
                  </div>

                  {/* Copy button */}
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); copyName(col.name) }}
                    className="p-1.5 rounded-md hover:bg-muted/60 transition-colors shrink-0"
                    title="Copy collection name"
                  >
                    {copied === col.name
                      ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                      : <Copy className="h-3.5 w-3.5 text-muted-foreground/40" />}
                  </button>
                </button>
              )
            })}
          </div>
        )}

        {/* Confirm Bar */}
        {selected.size > 0 && (
          <div className="sticky bottom-4 flex items-center justify-between gap-3 p-4 rounded-xl bg-background border border-border shadow-lg">
            <p className="text-[13px] text-muted-foreground">
              {selected.size} collection{selected.size !== 1 ? 's' : ''} selected: <span className="text-foreground font-medium">{Array.from(selected).join(', ')}</span>
            </p>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="px-4 py-2 text-[13px] font-medium rounded-lg bg-accent text-accent-foreground hover:bg-accent/90 transition-colors disabled:opacity-50 flex items-center gap-2 shrink-0"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Confirm Selection
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
