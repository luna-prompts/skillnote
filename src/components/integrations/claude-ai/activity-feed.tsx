'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronRight,
  Cookie,
  GitCommit,
  KeyRound,
  LinkIcon,
  Loader2,
  PlugZap,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react'
import {
  activityExportUrl,
  listActivity,
  type AuditEvent,
  type AuditEventOut,
} from '@/lib/api/claude-ai'
import { ActivityRowSkeleton } from './skeleton'
import { Download } from 'lucide-react'
import { friendlyIntegrationError } from '@/lib/claude-ai-errors'

interface Props {
  integration_id?: string
  /** Optional pre-applied skill filter — when set, only events for this
   *  skill are queried. Used by deep-links from the skill detail page. */
  skill_id?: string
  pageSize?: number
  pollIntervalMs?: number
  /** When true, the feed shows a compact dense layout (for the settings page). */
  compact?: boolean
}

const EVENT_META: Record<AuditEvent, { label: string; icon: React.ElementType; tone: string }> = {
  pair_started: { label: 'Pairing started', icon: PlugZap, tone: 'text-blue-500' },
  pair_approved: { label: 'Pairing approved', icon: CheckCircle2, tone: 'text-emerald-500' },
  pair_redeemed: { label: 'Browser connected', icon: KeyRound, tone: 'text-emerald-500' },
  pair_expired: { label: 'Pairing expired', icon: XCircle, tone: 'text-muted-foreground' },
  integration_disconnected: { label: 'Browser disconnected', icon: Trash2, tone: 'text-muted-foreground' },
  integration_updated: { label: 'Settings updated', icon: GitCommit, tone: 'text-muted-foreground' },
  skill_pushed: { label: 'Skill pushed to claude.ai', icon: ArrowUpFromLine, tone: 'text-blue-500' },
  skill_imported: { label: 'Skill imported from claude.ai', icon: ArrowDownToLine, tone: 'text-violet-500' },
  skill_delete_pushed: { label: 'Skill removed from claude.ai', icon: Trash2, tone: 'text-muted-foreground' },
  op_failed: { label: 'Sync operation failed', icon: XCircle, tone: 'text-red-500' },
  conflict_detected: { label: 'Conflict detected', icon: ShieldAlert, tone: 'text-amber-500' },
  conflict_resolved: { label: 'Conflict resolved', icon: CheckCircle2, tone: 'text-emerald-500' },
  endpoint_changed: { label: 'claude.ai endpoint changed', icon: ShieldAlert, tone: 'text-red-500' },
  token_revoked: { label: 'Token revoked', icon: KeyRound, tone: 'text-red-500' },
  cookie_expired: { label: 'claude.ai session expired', icon: Cookie, tone: 'text-amber-500' },
  op_retried: { label: 'Sync op retried', icon: ArrowUpFromLine, tone: 'text-blue-500' },
  sync_triggered: { label: 'Manual sync requested', icon: ArrowUpFromLine, tone: 'text-muted-foreground' },
}

export function ActivityFeed({
  integration_id,
  skill_id,
  pageSize = 25,
  pollIntervalMs = 10_000,
  compact = false,
}: Props) {
  const [events, setEvents] = useState<AuditEventOut[] | null>(null)
  const [eventFilter, setEventFilter] = useState<AuditEvent | ''>('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // Date range filters. Empty string means "no bound". datetime-local
  // inputs serialize as "YYYY-MM-DDTHH:mm" — convert to ISO at query time.
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')

  const baseFilters = useMemo(
    () => ({
      integration_id,
      skill_id,
      event: (eventFilter || undefined) as AuditEvent | undefined,
      since: since ? new Date(since).toISOString() : undefined,
      until: until ? new Date(until).toISOString() : undefined,
    }),
    [integration_id, skill_id, eventFilter, since, until],
  )

  // Once the user loads older pages, pause the poll so it doesn't wipe the
  // appended history every interval (the poll replaces events with page 1).
  const paginatedRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const rows = await listActivity({ ...baseFilters, limit: pageSize })
      setEvents(rows)
      // If we got a full page back, the backend probably has more older rows.
      // Cleared on the next poll once the user has loaded everything.
      setHasMore(rows.length === pageSize)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [baseFilters, pageSize])

  const loadMore = useCallback(async () => {
    if (!events || events.length === 0 || loadingMore) return
    setLoadingMore(true)
    try {
      const cursor = events[events.length - 1].created_at
      const older = await listActivity({
        ...baseFilters,
        limit: pageSize,
        before: cursor,
      })
      setEvents((prev) => (prev ? [...prev, ...older] : older))
      setHasMore(older.length === pageSize)
      paginatedRef.current = true
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }, [events, baseFilters, loadingMore, pageSize])

  useEffect(() => {
    // `load` identity changes when the filters change → treat as a fresh view.
    paginatedRef.current = false
    void load()
    const id = setInterval(() => {
      // Skip the poll once the user has paged into older history, so we don't
      // discard the loaded pages by replacing events with just the first page.
      if (document.visibilityState === 'visible' && !paginatedRef.current) void load()
    }, pollIntervalMs)
    return () => clearInterval(id)
  }, [load, pollIntervalMs])

  const visible = useMemo(() => {
    if (!events) return null
    if (!search.trim()) return events
    const needle = search.toLowerCase()
    return events.filter(
      (e) =>
        e.event.toLowerCase().includes(needle) ||
        JSON.stringify(e.detail).toLowerCase().includes(needle),
    )
  }, [events, search])

  return (
    <div>
      {!compact && (
        <>
          {skill_id && (
            <div
              className="mb-3 inline-flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1 text-[11.5px] text-muted-foreground"
              data-testid="activity-skill-filter-chip"
            >
              <span>Filtered to skill</span>
              <code className="rounded bg-background px-1.5 py-0.5 text-[10px] font-mono text-foreground">
                {skill_id.slice(0, 8)}…
              </code>
            </div>
          )}
          <div
            className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto_auto] items-stretch"
            data-testid="activity-toolbar"
          >
            <label className="sr-only" htmlFor="activity-search">
              Search activity
            </label>
            <input
              id="activity-search"
              type="search"
              placeholder="Search activity…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] focus:border-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
              aria-controls="activity-list"
            />
            <a
              href={activityExportUrl(baseFilters)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-foreground hover:bg-muted transition-colors"
              data-testid="activity-export-button"
              download
              aria-label="Export filtered activity as CSV"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </a>
          </div>
          <div className="mb-3 grid gap-2 sm:grid-cols-3 items-end">
            <div>
              <label
                htmlFor="activity-since"
                className="block text-[10.5px] uppercase tracking-wider text-muted-foreground/70 mb-1"
              >
                From
              </label>
              <input
                id="activity-since"
                type="datetime-local"
                value={since}
                onChange={(e) => setSince(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
              />
            </div>
            <div>
              <label
                htmlFor="activity-until"
                className="block text-[10.5px] uppercase tracking-wider text-muted-foreground/70 mb-1"
              >
                To
              </label>
              <input
                id="activity-until"
                type="datetime-local"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
              />
            </div>
            <div className="flex items-end gap-2">
              <label className="sr-only" htmlFor="activity-event-filter-mobile">
                Filter by event type
              </label>
              <select
                id="activity-event-filter-mobile"
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value as AuditEvent | '')}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
                aria-controls="activity-list"
              >
                <option value="">All events</option>
                {(Object.keys(EVENT_META) as AuditEvent[]).map((k) => (
                  <option key={k} value={k}>
                    {EVENT_META[k].label}
                  </option>
                ))}
              </select>
              {(since || until || eventFilter || search) && (
                <button
                  type="button"
                  onClick={() => {
                    setSince('')
                    setUntil('')
                    setEventFilter('')
                    setSearch('')
                  }}
                  className="shrink-0 rounded-md border border-border bg-background px-2 py-1.5 text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  data-testid="activity-clear-filters"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div
        id="activity-list"
        className={compact ? '' : 'rounded-lg border border-border bg-card'}
        aria-live="polite"
        aria-busy={visible === null}
      >
        {visible === null ? (
          <div className={compact ? '' : 'px-4'}>
            {[0, 1, 2].map((i) => (
              <ActivityRowSkeleton key={i} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className={`px-4 py-8 text-center text-[13px] text-muted-foreground ${compact ? '' : ''}`}>
            {events && events.length === 0
              ? 'No activity yet. Pair a browser and publish a skill to see events here.'
              : 'No events match the current filters.'}
          </div>
        ) : (
          <ul className="divide-y divide-border" role="list">
            {visible.map((e) => (
              <ActivityRow key={e.id} event={e} compact={compact} />
            ))}
          </ul>
        )}
      </div>
      {compact && events && events.length === pageSize && (
        <div className="mt-3 flex justify-center">
          <Link
            href="/settings/integrations/claude-ai/activity"
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
          >
            View full activity log <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
      {!compact && hasMore && events && events.length > 0 && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading older…
              </>
            ) : (
              <>Load older events</>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

function ActivityRow({ event, compact }: { event: AuditEventOut; compact: boolean }) {
  const meta = EVENT_META[event.event] ?? {
    label: event.event,
    icon: LinkIcon,
    tone: 'text-muted-foreground',
  }
  // A "skill_pushed" event whose op is a whole-group publish reads wrong as
  // "Skill pushed" — relabel it (the detail line carries the group/skill count).
  const isGroupPublish =
    event.event === 'skill_pushed' &&
    (event.detail as Record<string, unknown> | undefined)?.op_kind === 'publish_group'
  const label = isGroupPublish ? 'Published to claude.ai' : meta.label
  const Icon = meta.icon
  const subtitle = renderDetail(event)
  const [showDetail, setShowDetail] = useState(false)
  const hasDetail =
    !compact && event.detail && Object.keys(event.detail).length > 0
  return (
    <li
      className={`${compact ? 'py-2 px-3' : 'px-4 py-3'} hover:bg-muted/30`}
      data-testid={`activity-row-${event.id}`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-full bg-muted p-1.5 ${meta.tone}`}>
          <Icon className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-foreground truncate">{label}</div>
          {subtitle && (
            <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
          )}
        </div>
        {hasDetail && (
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            aria-expanded={showDetail}
            aria-label={showDetail ? 'Hide event details' : 'Show event details'}
            className="shrink-0 text-[10.5px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded border border-border bg-background"
          >
            {showDetail ? 'Hide' : 'Details'}
          </button>
        )}
        <time
          dateTime={event.created_at}
          className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
          title={new Date(event.created_at).toLocaleString()}
        >
          {timeAgo(event.created_at)}
        </time>
      </div>
      {showDetail && hasDetail && (
        <pre
          className="mt-2 ml-8 max-h-48 overflow-auto rounded bg-muted/40 px-2 py-1.5 text-[10.5px] font-mono text-foreground whitespace-pre-wrap break-words"
          data-testid={`activity-detail-${event.id}`}
        >
          {JSON.stringify(event.detail, null, 2)}
        </pre>
      )}
    </li>
  )
}

function renderDetail(e: AuditEventOut): string | null {
  const d = e.detail ?? {}
  if (e.event === 'pair_started' && d.browser_label)
    return String(d.browser_label)
  if (e.event === 'integration_disconnected' && d.browser_label)
    return String(d.browser_label)
  if (e.event === 'op_failed') {
    const op = d.op_kind ? String(d.op_kind) : 'operation'
    // Run the raw error through the same friendly translator the connector
    // card uses, so the feed shows a human reason — not a raw claude.ai URL.
    const err = d.error ? friendlyIntegrationError(String(d.error)).summary : ''
    return err ? `${op}: ${err}` : op
  }
  if (e.event === 'skill_pushed' || e.event === 'skill_imported' || e.event === 'skill_delete_pushed') {
    // Named-group publish: one op covers many skills and carries no single
    // skill_id, so summarize from the result payload instead of a blank line.
    if (d.op_kind === 'publish_group') {
      const r = (d.result ?? {}) as Record<string, unknown>
      const groups = Number(r.group_count ?? 0)
      const skills = Number(r.skill_count ?? 0)
      const retired = Number(r.retired_count ?? 0)
      const parts = [
        `${groups} group${groups === 1 ? '' : 's'}`,
        `${skills} skill${skills === 1 ? '' : 's'}`,
      ]
      if (retired > 0) parts.push(`${retired} retired`)
      return parts.join(' · ')
    }
    // Prefer the human skill slug; fall back to the opaque claude.ai id only
    // if we couldn't resolve the skill (e.g. it was deleted since the event).
    if (e.skill_slug) return e.skill_slug
    const result = d.result as Record<string, unknown> | undefined
    if (result?.claude_ai_skill_id) return String(result.claude_ai_skill_id)
  }
  return null
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
