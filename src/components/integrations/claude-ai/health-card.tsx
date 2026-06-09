'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { fetchHealth, type HealthMetrics } from '@/lib/api/claude-ai'
import { HealthCardSkeleton } from './skeleton'

interface Props {
  /** Pause polling when the page isn't visible to save backend cycles. */
  pollIntervalMs?: number
}

export function HealthCard({ pollIntervalMs = 15_000 }: Props) {
  const [data, setData] = useState<HealthMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [staleError, setStaleError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const h = await fetchHealth()
        if (!cancelled) {
          setData(h)
          setError(null)
          setStaleError(null)
        }
      } catch (e) {
        if (cancelled) return
        const msg = (e as Error).message
        // First load failure → blocking error. Later poll failures →
        // surface as a subtle warning so the user knows the visible
        // metrics may be stale, but don't replace the rendered card.
        // Use the setter callback form so we don't have to put `data`
        // in the effect deps (which would re-arm the timer on every
        // successful load and trigger an immediate refetch loop).
        setData((prev) => {
          if (prev) setStaleError(msg)
          else setError(msg)
          return prev
        })
      }
    }
    void load()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, pollIntervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [pollIntervalMs])

  if (!data) {
    return error ? (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-[13px] text-red-700 dark:text-red-300">
        Could not load health metrics: {error}
      </div>
    ) : (
      <HealthCardSkeleton />
    )
  }

  const overall = healthOverall(data)
  // Spinning loader was semantically wrong for a "warn" state. Use a
  // static warning glyph and let color carry the severity.
  const Icon = overall === 'ok' ? CheckCircle2 : AlertTriangle
  const tone =
    overall === 'ok'
      ? 'text-emerald-500'
      : overall === 'warn'
        ? 'text-amber-500'
        : 'text-red-500'

  return (
    <div className="rounded-lg border border-border bg-card p-5" data-testid="health-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${tone}`} aria-hidden="true" data-testid="health-icon" />
          <h3 className="text-[14px] font-medium text-foreground">claude.ai sync status</h3>
        </div>
        <span
          data-testid="health-status-chip"
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
            overall === 'ok'
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : overall === 'warn'
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'bg-red-500/10 text-red-600 dark:text-red-400'
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {overall === 'ok' ? 'Healthy' : overall === 'warn' ? 'Degraded' : 'Needs attention'}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Active" value={data.integrations_active} />
        <Stat
          label="With errors"
          value={data.integrations_with_errors}
          tone={data.integrations_with_errors > 0 ? 'text-red-500' : undefined}
        />
        <Stat label="Pending ops" value={data.pending_ops_total} />
        <Stat
          label="Failed ops"
          value={data.failed_ops_total}
          tone={data.failed_ops_total > 0 ? 'text-red-500' : undefined}
        />
        <Stat
          label="Conflicts"
          value={data.diverged_links_total}
          tone={data.diverged_links_total > 0 ? 'text-amber-500' : undefined}
        />
      </div>
      {staleError && (
        <div
          className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300"
          role="status"
        >
          <AlertTriangle className="h-3 w-3" />
          <span>Metrics may be stale — last refresh failed: {staleError}</span>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return (
    <div data-testid={`health-stat-${slug}`}>
      <div className={`text-[18px] font-semibold ${tone ?? 'text-foreground'}`}>
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

function healthOverall(h: HealthMetrics): 'ok' | 'warn' | 'bad' {
  if (h.integrations_with_errors > 0 || h.failed_ops_total > 0) return 'bad'
  if (h.diverged_links_total > 0 || h.pending_ops_total > 50) return 'warn'
  return 'ok'
}
