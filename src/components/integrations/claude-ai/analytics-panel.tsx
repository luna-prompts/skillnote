'use client'

/**
 * 7-day sync analytics panel.
 *
 * Drives the "Analytics" section under the Connector health card. Polls
 * every 30s while the page is visible (analytics queries are heavier than
 * the queue/health endpoints; 30s is the right balance between freshness
 * and DB load).
 *
 * Anatomy:
 *   ┌──── Headline metrics row ───────────────────────────┐
 *   │ 24h: 142 syncs  │ 7d: 893  │ Success: 99.4%  │ Avg │
 *   ├─────────────────────────────────────────────────────┤
 *   │ Sparkline:  ▁▂▃▅▇▆▄  (7 days)                       │
 *   ├─────────────────────────────────────────────────────┤
 *   │ Top synced (7d):                                    │
 *   │   pdf-extractor       142                           │
 *   │   git-helper           98                           │
 *   ├─────────────────────────────────────────────────────┤
 *   │ Per-browser breakdown:                              │
 *   │   Chrome on Mac     180   1 failed   2m ago         │
 *   └─────────────────────────────────────────────────────┘
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowUpFromLine,
  BarChart3,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import { fetchAnalytics, type AnalyticsResponse } from '@/lib/api/claude-ai'

interface Props {
  pollIntervalMs?: number
}

export function AnalyticsPanel({ pollIntervalMs = 30_000 }: Props) {
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const a = await fetchAnalytics()
      setData(a)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, pollIntervalMs)
    return () => clearInterval(id)
  }, [load, pollIntervalMs])

  if (!data) {
    return error ? (
      <div
        className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-[12px] text-red-700 dark:text-red-300"
        data-testid="analytics-error"
      >
        Couldn’t load analytics: {error}
      </div>
    ) : (
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="h-3 w-32 rounded bg-muted/40 animate-pulse" />
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded bg-muted/40 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  // No activity yet — show a friendly empty state rather than walls of
  // zeros. The header still renders so the panel doesn't disappear and
  // come back as the user pairs their first browser.
  const noActivity =
    data.skills_synced_7d === 0 &&
    data.failed_7d === 0 &&
    data.per_integration.every((p) => p.syncs_24h === 0 && p.failed_24h === 0)

  return (
    <div
      className="rounded-lg border border-border bg-card overflow-hidden"
      data-testid="claude-ai-analytics-panel"
    >
      <div className="border-b border-border bg-muted/30 px-4 py-2.5 flex items-center gap-2">
        <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-[13px] font-semibold text-foreground">
          Sync analytics
        </h3>
        <span className="text-[11px] text-muted-foreground/70">last 7 days</span>
      </div>

      {noActivity ? (
        <div className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">
          No syncs yet. Once your extension starts pushing skills you’ll
          see throughput and success-rate charts here.
        </div>
      ) : (
        <>
          {/* Headline metrics row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border border-b border-border">
            <Metric
              label="24h"
              value={data.skills_synced_24h}
              sublabel="syncs"
              failed={data.failed_24h}
              testid="metric-24h"
            />
            <Metric
              label="7d"
              value={data.skills_synced_7d}
              sublabel="syncs"
              failed={data.failed_7d}
              testid="metric-7d"
            />
            <Metric
              label="Success"
              value={`${((data.sync_success_rate_7d ?? 0) * 100).toFixed(1)}%`}
              sublabel="7-day"
              tone={
                (data.sync_success_rate_7d ?? 0) < 0.95
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }
              testid="metric-success"
            />
            <Metric
              label="Avg tries"
              value={(data.avg_attempts_per_sync_7d ?? 0).toFixed(2)}
              sublabel="per op"
              testid="metric-avg-tries"
            />
          </div>

          {/* Sparkline */}
          <div className="px-4 py-4 border-b border-border">
            <p className="mb-2 text-[11.5px] text-muted-foreground">
              Daily syncs (7d, UTC)
            </p>
            <Sparkline points={data.sparkline_7d} />
          </div>

          {/* Top synced skills */}
          {data.top_skills_7d.length > 0 && (
            <div className="px-4 py-3 border-b border-border">
              <p className="mb-2 text-[11.5px] font-medium text-foreground">
                Top synced (7d)
              </p>
              <ul className="space-y-1.5" data-testid="top-skills-list">
                {data.top_skills_7d.map((s, i) => (
                  <li
                    key={s.skill_id}
                    className="flex items-center justify-between text-[12px]"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-muted-foreground/60 font-mono tabular-nums shrink-0 w-4">
                        {i + 1}.
                      </span>
                      <Link
                        href={`/skills/${s.skill_slug}`}
                        className="text-foreground hover:underline truncate"
                      >
                        {s.skill_name}
                      </Link>
                    </span>
                    <span className="ml-3 shrink-0 inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                      <ArrowUpFromLine className="h-2.5 w-2.5" aria-hidden="true" />
                      {s.sync_count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Per-integration breakdown */}
          {data.per_integration.length > 0 && (
            <div className="px-4 py-3" data-testid="per-integration-breakdown">
              <p className="mb-2 text-[11.5px] font-medium text-foreground">
                Per-browser activity (24h)
              </p>
              <table className="w-full text-[11.5px]">
                <thead className="text-muted-foreground/70 text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left font-medium pb-1">Browser</th>
                    <th className="text-right font-medium pb-1 tabular-nums">Syncs</th>
                    <th className="text-right font-medium pb-1 tabular-nums">Failed</th>
                    <th className="text-right font-medium pb-1">Last sync</th>
                  </tr>
                </thead>
                <tbody>
                  {data.per_integration.map((p) => (
                    <tr
                      key={p.integration_id}
                      className="border-t border-border/50"
                    >
                      <td className="py-1.5 truncate text-foreground">
                        {p.integration_label ?? 'Unnamed browser'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-foreground">
                        {p.syncs_24h}
                      </td>
                      <td
                        className={`py-1.5 text-right tabular-nums ${p.failed_24h > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
                      >
                        {p.failed_24h}
                      </td>
                      <td className="py-1.5 text-right text-muted-foreground">
                        {p.last_sync_at ? timeAgo(p.last_sync_at) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Usage — how often Claude actually invoked skills on claude.ai.
              Distinct from sync (push) counts above. Only shows once there's
              real invocation data so synced-but-never-used skills don't read
              as a wall of zeros. */}
          {data.invocations_7d > 0 && (
            <div
              className="px-4 py-3 border-t border-border bg-muted/10"
              data-testid="usage-breakdown"
            >
              <p className="mb-2 text-[11.5px] font-medium text-foreground">
                Used on claude.ai
                <span className="ml-1.5 text-muted-foreground/70 font-normal">
                  {data.invocations_24h} in 24h · {data.invocations_7d} in 7d
                </span>
              </p>
              {data.top_used_skills_7d.length > 0 && (
                <ul className="space-y-1.5" data-testid="top-used-skills-list">
                  {data.top_used_skills_7d.map((s, i) => (
                    <li
                      key={s.skill_slug}
                      className="flex items-center justify-between text-[12px]"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-muted-foreground/60 font-mono tabular-nums shrink-0 w-4">
                          {i + 1}.
                        </span>
                        <Link
                          href={`/skills/${s.skill_slug}`}
                          className="text-foreground hover:underline truncate"
                        >
                          {s.skill_slug}
                        </Link>
                      </span>
                      <span className="ml-3 shrink-0 inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] tabular-nums text-emerald-700 dark:text-emerald-400">
                        {s.invocations}× used
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  sublabel,
  failed,
  tone,
  testid,
}: {
  label: string
  value: number | string
  sublabel: string
  failed?: number
  tone?: string
  testid?: string
}) {
  return (
    <div className="px-4 py-3" data-testid={testid}>
      <div className={`text-[18px] font-semibold tabular-nums ${tone ?? 'text-foreground'}`}>
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
        <span>{label}</span>
        <span className="text-muted-foreground/60">{sublabel}</span>
        {failed !== undefined && failed > 0 && (
          <span className="ml-1 text-red-600 dark:text-red-400 tabular-nums">
            · {failed} failed
          </span>
        )}
      </div>
    </div>
  )
}

function Sparkline({
  points,
}: {
  points: { date: string; syncs: number; failed: number }[]
}) {
  if (points.length === 0) return null
  const max = Math.max(1, ...points.map((p) => p.syncs))
  // 7 columns; each column has a syncs bar (foreground) stacked on a
  // failed bar (red). Pure SVG so it's crisp on any zoom and prints clean.
  const W = 280
  const H = 64
  const gap = 4
  const colW = (W - gap * (points.length - 1)) / points.length

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`7-day sync sparkline: ${points.map((p) => `${p.date} ${p.syncs}`).join(', ')}`}
      data-testid="analytics-sparkline"
      className="max-w-full"
    >
      {points.map((p, i) => {
        const total = p.syncs + p.failed
        const h = total === 0 ? 0 : Math.max(2, (p.syncs / max) * (H - 14))
        const fh = total === 0 ? 0 : Math.max(0, (p.failed / max) * (H - 14))
        const x = i * (colW + gap)
        return (
          <g key={p.date}>
            {/* Faint column track so a week of mostly-zero days still reads
                as a bar chart instead of one lone bar on a blank canvas. */}
            <rect x={x} y={2} width={colW} height={H - 2} rx={2.5} className="fill-muted" />
            {/* Failed (red) sits below the success bar so the eye reads
                them as a fraction of the column. */}
            {fh > 0 && (
              <rect
                x={x}
                y={H - fh}
                width={colW}
                height={fh}
                rx={2.5}
                className="fill-red-500/80"
              />
            )}
            {h > 0 && (
              <rect
                x={x}
                y={H - fh - h}
                width={colW}
                height={h}
                rx={2.5}
                className="fill-[var(--accent)]"
                data-syncs={p.syncs}
              />
            )}
            <title>{`${p.date}: ${p.syncs} synced${p.failed > 0 ? `, ${p.failed} failed` : ''}`}</title>
          </g>
        )
      })}
    </svg>
  )
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.max(0, Math.floor(diff / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
