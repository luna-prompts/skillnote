'use client'
import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { refreshSource } from '@/lib/api/imports'
import { toast } from 'sonner'

type DiffItem = {
  name: string
  description?: string
  forked_from_source?: boolean
}

export type DiffData = {
  source_id: string
  from_sha?: string | null
  to_sha?: string | null
  new: DiffItem[]
  changed: DiffItem[]
  removed: DiffItem[]
  error?: string
}

export function DiffDrawer({
  data,
  onClose,
  onApplied,
}: {
  data: DiffData
  onClose: () => void
  onApplied: () => void
}) {
  const [selectedNew, setSelectedNew] = useState<Set<string>>(
    new Set(data.new.map(s => s.name))
  )
  const [selectedChanged, setSelectedChanged] = useState<Set<string>>(
    new Set(data.changed.filter(s => !s.forked_from_source).map(s => s.name))
  )
  const [applying, setApplying] = useState(false)

  const total = selectedNew.size + selectedChanged.size

  async function doApply() {
    setApplying(true)
    try {
      await refreshSource(data.source_id, 'apply')
      toast.success(`Applied ${total} changes`)
      onApplied()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Apply failed')
      setApplying(false)
    }
  }

  const toggleNew = (name: string) => {
    const next = new Set(selectedNew)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelectedNew(next)
  }
  const toggleChanged = (name: string) => {
    const next = new Set(selectedChanged)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelectedChanged(next)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose}>
      <div
        className="absolute right-0 top-0 flex h-full w-[min(720px,90vw)] flex-col bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div>
            <h3 className="font-semibold">Upstream changes</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data.from_sha?.slice(0, 7) ?? '—'} → {data.to_sha?.slice(0, 7) ?? '—'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-auto p-6">
          {data.error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {data.error}
            </div>
          )}
          {data.new.length > 0 && (
            <Section
              title="New skills"
              items={data.new}
              selected={selectedNew}
              onToggle={toggleNew}
              variant="new"
            />
          )}
          {data.changed.length > 0 && (
            <Section
              title="Changed skills"
              items={data.changed}
              selected={selectedChanged}
              onToggle={toggleChanged}
              variant="changed"
            />
          )}
          {data.removed.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Removed upstream ({data.removed.length})
              </h4>
              <div className="rounded-md border border-border/30">
                {data.removed.map(s => (
                  <div
                    key={s.name}
                    className="flex items-center gap-2 border-b border-border/20 p-2 text-sm last:border-b-0"
                  >
                    {s.forked_from_source && (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    )}
                    <span>{s.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      will stay in SkillNote
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.new.length === 0 && data.changed.length === 0 && data.removed.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No changes detected. Source is up to date.
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-border/60 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md border border-border/60 bg-card px-3 py-1.5 text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={doApply}
            disabled={total === 0 || applying}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
          >
            {applying ? 'Applying…' : `Apply ${total} changes`}
          </button>
        </footer>
      </div>
    </div>
  )
}

function Section({
  title,
  items,
  selected,
  onToggle,
  variant,
}: {
  title: string
  items: DiffItem[]
  selected: Set<string>
  onToggle: (name: string) => void
  variant: 'new' | 'changed'
}) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} ({items.length})
      </h4>
      <div className="rounded-md border border-border/30">
        {items.map(s => (
          <label
            key={s.name}
            className="flex cursor-pointer items-start gap-2 border-b border-border/20 p-2 last:border-b-0 hover:bg-muted/30"
          >
            <input
              type="checkbox"
              checked={selected.has(s.name)}
              onChange={() => onToggle(s.name)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {s.name}
                {variant === 'changed' && s.forked_from_source && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                    forked — will overwrite your edits
                  </span>
                )}
              </div>
              {s.description && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {s.description.slice(0, 100)}
                </div>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}
