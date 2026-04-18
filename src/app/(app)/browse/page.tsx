'use client'
import { useEffect, useState } from 'react'
import { listSources, type SourceListItem } from '@/lib/api/imports'
import { BrowseEmptyState } from '@/components/browse/BrowseEmptyState'
import { BrowseSourcesList } from '@/components/browse/BrowseSourcesList'

export default function BrowsePage() {
  const [sources, setSources] = useState<SourceListItem[] | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    listSources().then(setSources).catch(() => setSources([]))
  }, [])

  if (sources === null) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
  }

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Browse</h1>
        <button
          onClick={() => setSheetOpen(true)}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-foreground/90">
          + Add source
        </button>
      </header>

      {sources.length === 0
        ? <BrowseEmptyState onPasteUrl={() => setSheetOpen(true)} />
        : <BrowseSourcesList sources={sources} />
      }

      {/* Placeholder — Task 15 replaces this with ImportSheet */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 bg-black/30" onClick={() => setSheetOpen(false)}>
          <div className="absolute right-0 top-0 h-full w-[600px] bg-card p-6">ImportSheet (Task 15)</div>
        </div>
      )}
    </div>
  )
}
