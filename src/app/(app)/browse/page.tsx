'use client'
import { useEffect, useState } from 'react'
import { listSources, refreshSource, type SourceListItem } from '@/lib/api/imports'
import { BrowseEmptyState } from '@/components/browse/BrowseEmptyState'
import { BrowseSourcesList } from '@/components/browse/BrowseSourcesList'
import { DiffDrawer, type DiffData } from '@/components/browse/DiffDrawer'
import { ImportSheet } from '@/components/browse/ImportSheet'
import { toast } from 'sonner'

export default function BrowsePage() {
  const [sources, setSources] = useState<SourceListItem[] | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [diffData, setDiffData] = useState<DiffData | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)

  useEffect(() => {
    listSources().then(setSources).catch(() => setSources([]))
  }, [])

  async function openDrift(s: SourceListItem) {
    if (loadingDiff) return
    setLoadingDiff(true)
    try {
      const data = (await refreshSource(s.id, 'preview')) as DiffData
      setDiffData({ ...data, source_id: s.id })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load diff')
    } finally {
      setLoadingDiff(false)
    }
  }

  if (sources === null) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
  }

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Browse</h1>
        <button
          onClick={() => setSheetOpen(true)}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-foreground/90"
        >
          + Add source
        </button>
      </header>

      {sources.length === 0 ? (
        <BrowseEmptyState onPasteUrl={() => setSheetOpen(true)} />
      ) : (
        <BrowseSourcesList sources={sources} onDriftClick={openDrift} />
      )}

      {sheetOpen && (
        <ImportSheet
          onClose={() => setSheetOpen(false)}
          onImported={() => {
            listSources().then(setSources).catch(() => {})
          }}
        />
      )}

      {diffData && (
        <DiffDrawer
          data={diffData}
          onClose={() => setDiffData(null)}
          onApplied={() => {
            listSources().then(setSources).catch(() => {})
          }}
        />
      )}
    </div>
  )
}
