'use client'

/**
 * Live sync-queue panel. Answers the user's #1 question: "Is my data
 * actually flowing?"
 *
 * Polls every 5s while the page is visible. Shows pending +
 * in_progress ops only (failed/completed are in the activity feed).
 * Each row identifies the skill + the kind + an age + a retry badge.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ Sync activity            5 pending, 1 in progress  ⟳     │
 *   │ ─────────────────────────────────────────────────────── │
 *   │ ↑ pdf-extractor      → Chrome on Mac     2s ago   try 1 │
 *   │ ⟳ git-helper         → Chrome on Mac    14s ago  try 2 │
 *   │ ↑ excel-formatter    → Edge on Windows  31s ago   try 1 │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Empty state: "All caught up — sync queue is clear."
 *
 * Stale-queue indicator: if oldest_age_seconds > 120, surface a soft
 * warning that something might be stuck. The activity feed already
 * shows op_failed events for the hard-failure case.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  ListFilter,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { fetchSyncQueue, type SyncOpKind, type SyncQueueResponse } from '@/lib/api/claude-ai'

interface Props {
  /** Optional scoping to one integration. */
  integration_id?: string
  pollIntervalMs?: number
}

const KIND_ICON: Record<SyncOpKind, React.ElementType> = {
  upload: ArrowUpFromLine,
  update: ArrowUpFromLine,
  delete: Trash2,
  list: ArrowDownToLine,
  fetch_one: ArrowDownToLine,
}

const KIND_LABEL: Record<SyncOpKind, string> = {
  upload: 'Push',
  update: 'Update',
  delete: 'Remove',
  list: 'Discover',
  fetch_one: 'Pull',
}

const STALE_THRESHOLD_SECONDS = 120

export function SyncQueuePanel({
  integration_id,
  pollIntervalMs = 5_000,
}: Props) {
  const [data, setData] = useState<SyncQueueResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const r = await fetchSyncQueue({ integration_id, limit: 50 })
      setData(r)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRefreshing(false)
    }
  }, [integration_id])

  useEffect(() => {
    void load()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, pollIntervalMs)
    return () => clearInterval(id)
  }, [load, pollIntervalMs])

  // Render-priority empty state: never show the panel if there's nothing
  // to show AND nothing has been pending recently. Save vertical space.
  if (data && data.total === 0) {
    return (
      <div
        className="rounded-lg border border-border bg-card px-4 py-3"
        data-testid="sync-queue-empty"
      >
        <div className="flex items-center gap-2">
          <ListFilter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <p className="text-[12.5px] text-muted-foreground">
            Sync queue is clear — all skills are up to date.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="rounded-lg border border-border bg-card overflow-hidden"
      data-testid="sync-queue-panel"
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ListFilter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-[13px] font-semibold text-foreground">
            Sync activity
          </h3>
          {data && (
            <span className="text-[11px] text-muted-foreground">
              {data.pending_count} pending
              {data.in_progress_count > 0 && `, ${data.in_progress_count} in progress`}
              {data.total > data.items.length && ` of ${data.total}`}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          aria-label="Refresh sync queue"
          className="text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 text-[11.5px] text-red-700 dark:text-red-300 bg-red-500/5 border-b border-border">
          Couldn’t load the queue: {error}
        </div>
      )}

      {data && data.oldest_age_seconds !== null && data.oldest_age_seconds > STALE_THRESHOLD_SECONDS && (
        <div
          className="px-4 py-2 text-[11.5px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border-b border-border"
          data-testid="sync-queue-stale-warning"
        >
          The oldest queued sync is {humanDuration(data.oldest_age_seconds)} old.
          The extension may be paused — check that your browser is open and
          signed in to claude.ai.
        </div>
      )}

      {data === null ? (
        <div className="p-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-8 rounded bg-muted/30 animate-pulse"
            />
          ))}
        </div>
      ) : data.items.length === 0 && data.total > 0 ? (
        // Edge case: filter scoped the visible list to 0 but total > 0.
        // Shouldn't happen in normal use; show a friendly fallback.
        <div className="px-4 py-3 text-[12px] text-muted-foreground">
          Queue items don’t match this filter.
        </div>
      ) : (
        <ul className="divide-y divide-border" role="list">
          {data.items.map((item) => (
            <QueueRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  )
}

function QueueRow({ item }: { item: SyncQueueResponse['items'][number] }) {
  const Icon = KIND_ICON[item.kind] ?? ArrowUpFromLine
  const inProgress = item.status === 'in_progress'
  const skillLabel = item.skill_name ?? item.skill_slug ?? (
    item.kind === 'list' ? 'reverse-sync scan' : 'unknown skill'
  )
  return (
    <li
      className="flex items-center gap-3 px-4 py-2 hover:bg-muted/20 transition-colors"
      data-testid={`sync-queue-row-${item.id}`}
    >
      <div className="shrink-0">
        {inProgress ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" aria-hidden="true" />
        ) : (
          <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12.5px]">
          <span className="font-medium text-muted-foreground tabular-nums shrink-0">
            {KIND_LABEL[item.kind]}
          </span>
          {item.skill_slug ? (
            <Link
              href={`/skills/${item.skill_slug}`}
              className="text-foreground hover:underline truncate"
              title={skillLabel}
            >
              {skillLabel}
            </Link>
          ) : (
            <span className="text-foreground truncate" title={skillLabel}>
              {skillLabel}
            </span>
          )}
          <span className="text-muted-foreground/70 shrink-0">·</span>
          <span
            className="text-muted-foreground truncate"
            title={item.integration_label ?? 'unknown browser'}
          >
            {item.integration_label ?? 'unknown browser'}
          </span>
        </div>
      </div>
      {item.attempts > 0 && (
        <span
          className="shrink-0 inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
          title={item.last_error ?? 'No error recorded'}
        >
          retry {item.attempts}
        </span>
      )}
      <time
        dateTime={item.created_at}
        className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
        title={new Date(item.created_at).toLocaleString()}
      >
        <Clock className="inline h-2.5 w-2.5 mr-1 -mt-0.5" aria-hidden="true" />
        {timeAgo(item.created_at)}
      </time>
    </li>
  )
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.max(0, Math.floor(diff / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function humanDuration(seconds: number): string {
  const s = Math.floor(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`
  const h = Math.floor(m / 60)
  return `${h} hour${h === 1 ? '' : 's'}`
}
