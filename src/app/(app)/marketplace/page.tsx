'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { fetchCollectionsApi, type CollectionListItem } from '@/lib/api/collections'
import { ImportPanel } from '@/components/browse/ImportPanel'
import { ModeToggle } from '@/components/layout/mode-toggle'

export default function MarketplacePage() {
  const router = useRouter()
  const [allCollections, setAllCollections] = useState<CollectionListItem[]>([])

  const reload = useCallback(() => {
    fetchCollectionsApi()
      .then(setAllCollections)
      .catch(() => setAllCollections([]))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const existingCollectionSlugs = allCollections.map((c) => c.name)

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Install from a marketplace</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            Pull skills from any Claude Code plugin marketplace on GitHub: whole repos,
            a subfolder, or an <code className="font-mono">anthropic.json</code> manifest.
          </p>
        </div>
        <ModeToggle />
      </header>

      <ImportPanel
        existingCollectionSlugs={existingCollectionSlugs}
        onImported={reload}
        onViewLibrary={() => {
          reload()
          router.push('/collections')
        }}
      />
    </div>
  )
}
