'use client'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BookMarked, Download } from 'lucide-react'

import { listSources, refreshSource, type SourceListItem } from '@/lib/api/imports'
import { LibraryView } from '@/components/browse/LibraryView'
import { ImportPanel } from '@/components/browse/ImportPanel'
import { DiffDrawer, type DiffData } from '@/components/browse/DiffDrawer'
import { ModeToggle } from '@/components/layout/mode-toggle'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'

type TabId = 'library' | 'import'

export default function BrowsePage() {
  const [sources, setSources] = useState<SourceListItem[] | null>(null)
  const [diffData, setDiffData] = useState<DiffData | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)
  // Default to Add-source tab so the primary action is immediate.
  const [tab, setTab] = useState<TabId>('import')

  const reload = useCallback(() => {
    listSources()
      .then(setSources)
      .catch(() => setSources([]))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

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

  const sourceCount = sources?.length ?? 0

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Browse</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            Import curated SKILL.md libraries from GitHub — whole repos, marketplace manifests, or
            any subfolder. Imports track upstream so you see drift at a glance.
          </p>
        </div>
        <ModeToggle />
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="w-full">
        <TabsList className="mb-5">
          <TabsTrigger value="library" className="gap-2">
            <BookMarked className="h-3.5 w-3.5" />
            Library
            {sourceCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 rounded-full px-1.5 text-[10.5px]">
                {sourceCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="import" className="gap-2">
            <Download className="h-3.5 w-3.5" />
            Add source
          </TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="mt-0 focus-visible:outline-none">
          <LibraryView
            sources={sources}
            onDriftClick={openDrift}
            onChanged={reload}
            onSwitchToImport={() => setTab('import')}
          />
        </TabsContent>

        <TabsContent value="import" className="mt-0 focus-visible:outline-none">
          <ImportPanel
            onImported={() => {
              reload()
              // After import success, jump back to Library so user sees the result
              setTimeout(() => setTab('library'), 900)
            }}
          />
        </TabsContent>
      </Tabs>

      {diffData && (
        <DiffDrawer data={diffData} onClose={() => setDiffData(null)} onApplied={reload} />
      )}
    </div>
  )
}
