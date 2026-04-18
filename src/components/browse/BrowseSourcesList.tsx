'use client'
import type { SourceListItem } from '@/lib/api/imports'
import { BrowseSourceCard } from './BrowseSourceCard'

export function BrowseSourcesList({
  sources,
  onDriftClick,
  onChanged,
}: {
  sources: SourceListItem[]
  onDriftClick?: (source: SourceListItem) => void
  onChanged?: () => void
}) {
  return (
    <div className="space-y-3">
      {sources.map(s => (
        <BrowseSourceCard
          key={s.id}
          source={s}
          onDriftClick={onDriftClick}
          onChanged={onChanged}
        />
      ))}
    </div>
  )
}
