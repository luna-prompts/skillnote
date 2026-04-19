'use client'
import { useMemo, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Compass, Search } from 'lucide-react'

import type { SourceListItem } from '@/lib/api/imports'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { BrowseSourceCard } from '@/components/browse/BrowseSourceCard'

type Props = {
  sources: SourceListItem[] | null
  onDriftClick: (s: SourceListItem) => void
  onChanged: () => void
  onSwitchToImport: () => void
}

const PAGE_SIZE = 10

export function LibraryView({ sources, onDriftClick, onChanged, onSwitchToImport }: Props) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    if (!sources) return null
    const q = query.trim().toLowerCase()
    if (!q) return sources
    return sources.filter((s) => {
      const hay = `${s.owner ?? ''}/${s.repo ?? ''} ${s.collection_slug} ${s.ref ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [sources, query])

  const totalPages = filtered ? Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)) : 1
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const pageItems = filtered ? filtered.slice(pageStart, pageStart + PAGE_SIZE) : null

  if (sources === null) return <Skeletons />
  if (sources.length === 0) return <EmptyLibrary onAdd={onSwitchToImport} />

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            placeholder="Search owner, repo, collection…"
            className="h-9 pl-8 text-[13px]"
            aria-label="Search sources"
          />
        </div>
        <div className="text-[11.5px] text-muted-foreground">
          {filtered
            ? `${filtered.length} of ${sources.length} source${sources.length === 1 ? '' : 's'}`
            : ''}
        </div>
      </div>

      {pageItems && pageItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 px-4 py-10 text-center text-[12.5px] text-muted-foreground">
          No sources match <span className="font-mono">{query}</span>.
        </div>
      ) : (
        <div className="space-y-2.5">
          {pageItems?.map((s) => (
            <BrowseSourceCard
              key={s.id}
              source={s}
              onDriftClick={onDriftClick}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}

      {filtered && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-border/40 pt-3">
          <div className="text-[11.5px] text-muted-foreground">
            Page {safePage} of {totalPages} · showing {pageStart + 1}–
            {Math.min(pageStart + PAGE_SIZE, filtered.length)}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-7 px-2"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-7 px-2"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyLibrary({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/10 px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Compass className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold">Your library is empty</h3>
      <p className="mt-1 max-w-md text-[12.5px] text-muted-foreground">
        Start by adding a source from GitHub. SkillNote will clone the repo, scan SKILL.md files,
        and keep everything in sync.
      </p>
      <Button onClick={onAdd} className="mt-5">
        Add your first source
        <ArrowRight className="ml-2 h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

function Skeletons() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}
