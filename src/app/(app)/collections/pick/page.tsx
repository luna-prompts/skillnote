'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { Search, Check, Copy, FolderOpen, Loader2, Layers, ArrowLeft, Sparkles } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { resolvePickSession } from '@/lib/api/sessions'
import { getApiBaseUrl } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type Collection = { name: string; count: number }

export default function PickPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 flex items-center justify-center">
        <div className="h-5 w-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    }>
      <PickContent />
    </Suspense>
  )
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true } catch {}
  }
  // Fallback
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;opacity:0'
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy'); return true } catch { return false } finally { document.body.removeChild(ta) }
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
        setError('Could not load collections from SkillNote API')
        setLoading(false)
      })
  }, [])

  const filtered = useMemo(
    () => collections.filter(c => c.name.toLowerCase().includes(search.toLowerCase())),
    [collections, search]
  )

  const totalSkills = useMemo(
    () => Array.from(selected).reduce((sum, name) => {
      const col = collections.find(c => c.name === name)
      return sum + (col?.count ?? 0)
    }, 0),
    [selected, collections]
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

  const handleCopy = async (name: string) => {
    const ok = await copyText(name)
    if (ok) { setCopied(name); setTimeout(() => setCopied(null), 2000) }
  }

  // ── No token ──
  if (!token) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-[280px]">
          <div className="w-16 h-16 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center mx-auto mb-4">
            <Layers className="h-7 w-7 text-muted-foreground/30" />
          </div>
          <p className="text-[15px] font-semibold text-foreground mb-1">No Session</p>
          <p className="text-[13px] text-muted-foreground/60">
            Open this page from Claude Code using <span className="font-mono text-[12px] text-foreground/70">/skillnote:collection</span>
          </p>
        </div>
      </div>
    )
  }

  // ── Done ──
  if (done) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-[320px] opacity-0" style={{ animation: 'fadeUp 0.4s ease-out forwards' }}>
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <Check className="h-7 w-7 text-emerald-500" />
          </div>
          <h2 className="text-[17px] font-semibold text-foreground mb-1">Selection Sent</h2>
          <p className="text-[13px] text-muted-foreground mb-4">
            Return to Claude Code — your collections are being applied automatically.
          </p>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border/40">
            <Sparkles className="h-3 w-3 text-accent" />
            <span className="text-[12px] text-muted-foreground">
              {Array.from(selected).join(', ')} ({totalSkills} skills)
            </span>
          </div>
        </div>
      </div>
    )
  }

  // ── Main picker ──
  return (
    <>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }
        @keyframes slideUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:none } }
      `}</style>

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">

          {/* ── Header ── */}
          <div className="mb-6 opacity-0" style={{ animation: 'fadeUp 0.35s ease-out forwards' }}>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                <Layers className="h-4 w-4 text-accent" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground">Pick Collections</h1>
                <p className="text-[12px] text-muted-foreground">
                  Select which skill collections to sync for your project
                </p>
              </div>
            </div>
          </div>

          {/* ── Search ── */}
          <div className="relative mb-5 opacity-0" style={{ animation: 'fadeUp 0.35s ease-out 0.06s forwards' }}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search collections..."
              className="w-full pl-10 pr-4 py-2.5 text-[13px] bg-muted/40 border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent placeholder:text-muted-foreground/40 transition-all"
              autoFocus
            />
            {collections.length > 0 && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/40 tabular-nums">
                {filtered.length} of {collections.length}
              </span>
            )}
          </div>

          {/* ── Tip ── */}
          <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/15 opacity-0" style={{ animation: 'fadeUp 0.35s ease-out 0.12s forwards' }}>
            <Sparkles className="h-3.5 w-3.5 text-accent shrink-0" />
            <p className="text-[11px] text-muted-foreground">
              Keep <span className="font-medium text-foreground">12-15 skills</span> per collection for best Claude Code performance. Too many skills = descriptions get truncated = skills stop triggering.
            </p>
          </div>

          {/* ── Error ── */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-[12px] text-destructive">
              {error}
            </div>
          )}

          {/* ── Grid ── */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="animate-pulse rounded-xl border border-border/30 bg-muted/20 h-[72px]" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center mx-auto mb-3">
                <FolderOpen className="h-6 w-6 text-muted-foreground/25" />
              </div>
              <p className="text-[14px] font-medium text-foreground/70 mb-1">
                {search ? 'No matches' : 'No collections'}
              </p>
              <p className="text-[12px] text-muted-foreground/50 max-w-[200px] mx-auto">
                {search ? `Nothing matches "${search}"` : 'Create skills with collections in the web UI first.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-28">
              {filtered.map((col, i) => {
                const isSelected = selected.has(col.name)
                return (
                  <button
                    key={col.name}
                    type="button"
                    onClick={() => toggle(col.name)}
                    className={cn(
                      'group flex items-center gap-3 p-4 rounded-xl border text-left transition-all duration-200 opacity-0',
                      isSelected
                        ? 'border-accent/40 bg-accent/5 shadow-sm'
                        : 'border-border/40 bg-card hover:border-border/80 hover:shadow-md dark:hover:shadow-black/30'
                    )}
                    style={{ animation: `fadeUp 0.35s ease-out ${0.15 + i * 0.04}s forwards` }}
                  >
                    {/* Checkbox */}
                    <div className={cn(
                      'w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all duration-150',
                      isSelected ? 'bg-accent border-accent scale-105' : 'border-muted-foreground/25 group-hover:border-muted-foreground/40'
                    )}>
                      {isSelected && <Check className="h-3 w-3 text-white" />}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        'text-[14px] font-semibold truncate transition-colors',
                        isSelected ? 'text-accent' : 'text-foreground group-hover:text-foreground'
                      )}>
                        {col.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground/60 tabular-nums">
                        {col.count} skill{col.count !== 1 ? 's' : ''}
                      </p>
                    </div>

                    {/* Copy */}
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); handleCopy(col.name) }}
                      className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted/60 transition-all"
                      title="Copy name"
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
        </div>
      </div>

      {/* ── Sticky confirm bar ── */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 opacity-0"
          style={{ animation: 'slideUp 0.25s ease-out forwards' }}
        >
          <div className="max-w-2xl mx-auto px-4 sm:px-6 pb-6">
            <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-card/95 backdrop-blur-md border border-border/60 shadow-xl dark:shadow-black/40">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground truncate">
                  {Array.from(selected).join(', ')}
                </p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {selected.size} collection{selected.size !== 1 ? 's' : ''} &middot; {totalSkills} skills
                </p>
              </div>
              <Button
                onClick={handleConfirm}
                disabled={submitting}
                size="sm"
                className="bg-accent text-accent-foreground hover:bg-accent/90 border-0 h-9 px-5 text-[13px] font-medium gap-2 shrink-0"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
