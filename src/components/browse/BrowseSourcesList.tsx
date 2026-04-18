'use client'
import type { SourceListItem } from '@/lib/api/imports'

export function BrowseSourcesList({
  sources,
  onDriftClick,
}: {
  sources: SourceListItem[]
  onDriftClick?: (source: SourceListItem) => void
}) {
  return (
    <div className="space-y-3">
      {sources.map(s => (
        <div key={s.id} className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">
                {s.owner}/{s.repo}
              </div>
              <div className="text-xs text-muted-foreground">
                {s.ref ?? 'main'} · {s.imported_at_sha?.slice(0, 7)} · {s.skill_count} skills
              </div>
            </div>
            <StatusPill
              status={s.status}
              summary={s.drift_summary}
              onClick={
                s.status === 'drift' && onDriftClick
                  ? () => onDriftClick(s)
                  : undefined
              }
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function StatusPill({
  status,
  summary,
  onClick,
}: {
  status: string
  summary?: { new: number; changed: number; removed: number }
  onClick?: () => void
}) {
  if (status === 'up_to_date') {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        up to date
      </span>
    )
  }
  if (status === 'drift') {
    const label = summary
      ? `${summary.new} new · ${summary.changed} changed`
      : 'drift'
    if (onClick) {
      return (
        <button
          type="button"
          onClick={onClick}
          className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/25 dark:text-amber-400"
        >
          {label}
        </button>
      )
    }
    return (
      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        {label}
      </span>
    )
  }
  return (
    <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
      unreachable
    </span>
  )
}
