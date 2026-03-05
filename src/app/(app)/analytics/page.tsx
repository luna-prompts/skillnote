'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { TopBar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'
import { getApiBaseUrl } from '@/lib/api/client'
import { useKeyboardShortcut } from '@/lib/hooks'
import { toast } from 'sonner'
import {
  Zap, BookOpen, Users, Activity, TrendingUp, Radio, WifiOff,
  ChevronDown, ChevronRight, RefreshCw, BarChart2, PieChart as PieChartIcon,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts'
import {
  fetchAnalyticsSummary,
  fetchSkillCalls,
  fetchAgents,
  fetchTimeline,
  fetchCollections,
  type AnalyticsSummary,
  type SkillCallStat,
  type AgentStat,
  type TimelinePoint,
  type CollectionStat,
} from '@/lib/api/analytics'

// ─── MCP types ────────────────────────────────────────────────────────────────

type McpConnection = {
  id: string
  connected_at: number
  duration_seconds: number
  last_seen: number
  user_agent: string
  remote: string
  scope: string | null
  client_name: string
  client_version: string
  proto_version: string
  call_count: number
}

type McpStatus = {
  status: 'online' | 'offline'
  uptime_seconds: number
  active_connections: number
  connections: McpConnection[]
}

// ─── Agent catalog ────────────────────────────────────────────────────────────

const AGENT_CATALOG: Record<string, { label: string; color: string }> = {
  'claude-code': { label: 'Claude Code', color: '#8B5CF6' },
  openclaw:      { label: 'OpenClaw',    color: '#A855F7' },
  cursor:        { label: 'Cursor',      color: '#06B6D4' },
  openhands:     { label: 'OpenHands',   color: '#F59E0B' },
  codex:         { label: 'Codex',       color: '#10B981' },
  cline:         { label: 'Cline',       color: '#3B82F6' },
  windsurf:      { label: 'Windsurf',    color: '#14B8A6' },
  python:        { label: 'Python',      color: '#EAB308' },
  node:          { label: 'Node.js',     color: '#84CC16' },
  curl:          { label: 'curl',        color: '#6B7280' },
  other:         { label: 'Other',       color: '#6B7280' },
}

const TILE_COLORS = ['#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#EC4899']

function categorize(s: string): string {
  const n = s.toLowerCase()
  if (n.includes('claude'))    return 'claude-code'
  if (n.includes('openclaw'))  return 'openclaw'
  if (n.includes('cursor'))    return 'cursor'
  if (n.includes('openhands')) return 'openhands'
  if (n.includes('codex'))     return 'codex'
  if (n.includes('cline'))     return 'cline'
  if (n.includes('windsurf'))  return 'windsurf'
  if (n.includes('python') || n.includes('httpx') || n.includes('requests')) return 'python'
  if (n.includes('node') || n.includes('axios') || n.includes('undici'))     return 'node'
  if (n.includes('curl'))      return 'curl'
  return 'other'
}

function buildMcpBase() {
  return getApiBaseUrl().replace(':8082', ':8083').replace(/\/v1\/?$/, '').replace(/\/$/, '')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—'
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const secs = Math.floor(diff / 1000)
    if (secs < 60) return `${secs}s ago`
    const mins = Math.floor(secs / 60)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  } catch {
    return '—'
  }
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) {
    const s = seconds % 60
    return s > 0 ? `${mins}m ${s}s` : `${mins}m`
  }
  const hours = Math.floor(mins / 60)
  const m = mins % 60
  if (hours < 24) return m > 0 ? `${hours}h ${m}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const h = hours % 24
  return h > 0 ? `${days}d ${h}h` : `${days}d`
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 600): number {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let rafId: number
    const start = performance.now()
    const animate = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      setValue(Math.round(target * eased))
      if (progress < 1) {
        rafId = requestAnimationFrame(animate)
      }
    }
    rafId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafId)
  }, [target, duration])
  return value
}

// ─── Small components ─────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted/40', className)} />
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const W = 120, H = 24
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H - (v / max) * H,
  }))
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const fillD = pathD + ` L${W},${H} L0,${H} Z`
  return (
    <svg width={W} height={H} className="overflow-visible" aria-hidden="true">
      <path d={fillD} fill="var(--accent)" fillOpacity={0.15} />
      <path d={pathD} fill="none" stroke="var(--accent)" strokeOpacity={0.6} strokeWidth={1.5} />
    </svg>
  )
}

function FilterDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(o => o.value === value)?.label ?? label

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all',
          'border-border/50 bg-card hover:bg-accent/5 text-foreground'
        )}
      >
        {current}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-border/50 bg-popover shadow-lg py-1">
            {options.map(opt => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-[12px] hover:bg-accent/8 transition-colors',
                  opt.value === value ? 'text-accent font-medium' : 'text-foreground'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Custom recharts tooltips
function CustomTimelineTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload: TimelinePoint }>
}) {
  if (!active || !payload?.length) return null
  const pt = payload[0].payload
  return (
    <div className="bg-card border border-border/50 rounded-lg px-3 py-2 text-[12px] shadow-lg">
      <span className="font-mono text-foreground">{pt.date}: </span>
      <span className="font-mono font-semibold text-foreground">{pt.call_count.toLocaleString()} calls</span>
    </div>
  )
}

function CustomDonutTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; payload: { color: string; pct: number } }>
}) {
  if (!active || !payload?.length) return null
  const item = payload[0]
  return (
    <div className="bg-card border border-border/50 rounded-lg px-3 py-2 text-[12px] shadow-lg">
      <div className="font-medium text-foreground">{item.name}</div>
      <div className="font-mono text-muted-foreground/70">
        {item.value.toLocaleString()} calls · {item.payload.pct.toFixed(1)}%
      </div>
    </div>
  )
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  icon: Icon,
  label,
  value,
  loading,
  accent,
  index = 0,
  sparklineData,
  trendPct,
}: {
  icon: React.ElementType
  label: string
  value: number | string | null
  loading: boolean
  accent?: boolean
  index?: number
  sparklineData?: number[]
  trendPct?: number | null
}) {
  const numVal = typeof value === 'number' ? value : null
  const animated = useCountUp(numVal ?? 0)

  return (
    <div
      className={cn(
        'rounded-xl border border-border/50 bg-card px-4 py-3.5 flex flex-col gap-1.5',
        'opacity-0 [animation:fadeUp_0.4s_ease-out_forwards]',
        accent && 'border-accent/20 bg-accent/3'
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={cn('h-[15px] w-[15px] shrink-0', accent && 'text-accent')} />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <>
          <p className={cn(
            'text-[22px] font-semibold tabular-nums leading-none',
            accent ? 'text-accent' : 'text-foreground'
          )}>
            {numVal !== null ? animated.toLocaleString() : (value ?? '—')}
          </p>
          {trendPct !== null && trendPct !== undefined && (
            <p className={cn('text-[11px] font-medium', trendPct >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
              {trendPct >= 0 ? '↑' : '↓'} {Math.abs(trendPct).toFixed(1)}%
            </p>
          )}
          {accent && sparklineData && sparklineData.length >= 2 && (
            <div className="mt-1">
              <Sparkline data={sparklineData} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Illustrated empty states ─────────────────────────────────────────────────

function LeaderboardEmpty() {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center px-4">
      <pre className="text-muted-foreground/25 text-[11px] font-mono leading-tight select-none">{
`╭───╮
│   │
╰─┬─╯
  │
──┴──`
      }</pre>
      <p className="text-[12px] text-muted-foreground/50 max-w-[220px]">
        Skills get tracked here once your first MCP tool call fires.
      </p>
      <code className="text-[10px] font-mono text-muted-foreground/30 bg-muted/20 rounded px-2 py-1">
        Use any skill via Claude Code → calls appear here
      </code>
    </div>
  )
}

function AgentBreakdownEmpty() {
  const placeholders = ['Claude Code', 'Cursor', 'OpenHands', 'Cline']
  return (
    <div className="flex flex-col items-center gap-4 py-10 px-4">
      <div className="flex items-center gap-4 flex-wrap justify-center">
        {placeholders.map(name => (
          <div key={name} className="flex flex-col items-center gap-1.5">
            <div className="w-8 h-8 rounded-full border-2 border-dashed border-muted-foreground/20" />
            <span className="text-[10px] font-mono text-muted-foreground/30">{name}</span>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground/50">Waiting for agents to connect...</p>
    </div>
  )
}

const GHOST_HEIGHTS = [30, 55, 45, 70, 35, 60, 50, 40]

function TimelineEmpty() {
  return (
    <div className="px-4 pt-4 pb-5 relative">
      <div className="flex items-end gap-1 h-28">
        {GHOST_HEIGHTS.map((h, i) => (
          <div key={i} className="flex-1 bg-muted/20 rounded-t-sm" style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[13px] text-muted-foreground/50 bg-background/80 px-3 py-1 rounded-lg">
          No activity yet
        </span>
      </div>
    </div>
  )
}

function LiveConnectionsEmpty() {
  return (
    <div className="flex flex-col gap-2 py-4 px-4">
      <div className="flex items-center gap-3 py-2">
        <div className="relative w-2.5 h-2.5 shrink-0">
          <div className="absolute inset-0 rounded-full bg-muted-foreground/20 animate-pulse" />
        </div>
        <span className="text-[12px] font-mono text-muted-foreground/40">Listening on :8083...</span>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

function AnalyticsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const days = searchParams.get('days') ? Number(searchParams.get('days')) : 30
  const agentFilter = searchParams.get('agent') ?? ''
  const collectionFilter = searchParams.get('collection') ?? ''

  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [skillCalls, setSkillCalls] = useState<SkillCallStat[]>([])
  const [agents, setAgents] = useState<AgentStat[]>([])
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [collections, setCollections] = useState<CollectionStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trendPct, setTrendPct] = useState<number | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchedAt, setFetchedAt] = useState(Date.now())
  const [secondsLeft, setSecondsLeft] = useState(30)
  const [agentView, setAgentView] = useState<'bars' | 'donut'>('bars')
  const [ldrMounted, setLdrMounted] = useState(false)

  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null)
  const [mcpError, setMcpError] = useState(false)

  const params = {
    days: days === 0 ? undefined : days,
    agent: agentFilter || undefined,
    collection: collectionFilter || undefined,
  }

  const fetchAll = useCallback(async () => {
    try {
      setError(null)
      const [s, sc, ag, tl, col] = await Promise.all([
        fetchAnalyticsSummary(params),
        fetchSkillCalls(params),
        fetchAgents(params),
        fetchTimeline(params),
        fetchCollections(params),
      ])
      setSummary(s)
      setSkillCalls(sc)
      setAgents(ag)
      setTimeline(tl)
      setCollections(col)
      setLastUpdatedAt(new Date().toISOString())
      setFetchedAt(Date.now())

      // Compute trend for total_calls vs previous equivalent period
      if (days > 0) {
        try {
          const doubleSummary = await fetchAnalyticsSummary({ ...params, days: days * 2 })
          const prevCalls = doubleSummary.total_calls - s.total_calls
          if (prevCalls > 0) {
            setTrendPct(((s.total_calls - prevCalls) / prevCalls) * 100)
          } else {
            setTrendPct(null)
          }
        } catch {
          setTrendPct(null)
        }
      } else {
        setTrendPct(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, agentFilter, collectionFilter])

  // Leaderboard bar mount animation — flip once after first data load
  useEffect(() => {
    if (skillCalls.length > 0 && !ldrMounted) {
      const t = setTimeout(() => setLdrMounted(true), 50)
      return () => clearTimeout(t)
    }
  }, [skillCalls.length, ldrMounted])

  useEffect(() => {
    setLoading(true)
    fetchAll()
    const id = setInterval(fetchAll, 30000)
    return () => clearInterval(id)
  }, [fetchAll])

  // Countdown to next auto-refresh
  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - fetchedAt) / 1000)
      setSecondsLeft(Math.max(0, 30 - elapsed))
    }, 1000)
    return () => clearInterval(id)
  }, [fetchedAt])

  // MCP status polling every 5s
  useEffect(() => {
    const pollMcp = async () => {
      try {
        const res = await fetch(`${buildMcpBase()}/status`, { signal: AbortSignal.timeout(3000) })
        if (!res.ok) throw new Error()
        const data: McpStatus = await res.json()
        setMcpStatus(data)
        setMcpError(false)
      } catch {
        setMcpError(true)
        setMcpStatus(null)
      }
    }
    pollMcp()
    const id = setInterval(pollMcp, 5000)
    return () => clearInterval(id)
  }, [])

  // Manual refresh with toast
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchAll()
    setRefreshing(false)
    toast.success('Analytics refreshed')
  }, [fetchAll])

  // R key shortcut
  useKeyboardShortcut('r', handleRefresh, [handleRefresh])

  // URL param helpers
  function setParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (value === '' || (value === '0' && key !== 'days')) {
      p.delete(key)
    } else {
      p.set(key, value)
    }
    router.push(`/analytics?${p.toString()}`)
  }

  const agentOptions = [
    { value: '', label: 'All Agents' },
    ...Array.from(new Set(agents.map(a => a.agent_name))).map(n => ({
      value: n,
      label: AGENT_CATALOG[categorize(n)]?.label ?? n,
    })),
  ]

  const collectionOptions = [
    { value: '', label: 'All Collections' },
    ...Array.from(new Set(collections.map(c => c.scope ?? ''))).map(s => ({
      value: s,
      label: s || 'No filter',
    })),
  ]

  const daysOptions = [
    { value: '7', label: 'Last 7 days' },
    { value: '30', label: 'Last 30 days' },
    { value: '90', label: 'Last 90 days' },
    { value: '0', label: 'All time' },
  ]

  // Chart calculations
  const maxSkillCalls = skillCalls.reduce((m, s) => Math.max(m, s.call_count), 0)
  const maxCollection = collections.reduce((m, c) => Math.max(m, c.call_count), 0)
  const sparklineData = timeline.slice(-12).map(t => t.call_count)
  const totalAgentCalls = agents.reduce((sum, a) => sum + a.call_count, 0)
  const totalCollectionCalls = collections.reduce((sum, c) => sum + c.call_count, 0)
  const showTreemap = collections.length > 0 && collections.length <= 6
  const treemapCols = showTreemap
    ? collections.map(c => `${(c.call_count / totalCollectionCalls) * 100}fr`).join(' ')
    : ''

  const donutData = agents.map(a => {
    const cat = categorize(a.agent_name)
    const info = AGENT_CATALOG[cat] ?? AGENT_CATALOG.other
    return { name: info.label, value: a.call_count, color: info.color, pct: a.pct }
  })

  const refreshProgress = Math.min(((30 - secondsLeft) / 30) * 100, 100)

  return (
    <>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="flex flex-col min-h-screen">
        <TopBar showFab={false} />

        {/* ── Filter bar ──────────────────────────────────────────────────── */}
        <div className="sticky top-0 z-30 border-b border-border/50 bg-background/90 backdrop-blur-sm relative">
          <div className="px-6 py-2.5 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mr-1">Filter:</span>

            {/* Time range tabs */}
            <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-0.5">
              {daysOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setParam('days', opt.value)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[12px] font-medium transition-all',
                    String(days) === opt.value || (opt.value === '30' && !searchParams.get('days'))
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {opt.value === '7' ? '7d' : opt.value === '30' ? '30d' : opt.value === '90' ? '90d' : 'All'}
                </button>
              ))}
            </div>

            <FilterDropdown
              label="All Agents"
              value={agentFilter}
              options={agentOptions}
              onChange={v => setParam('agent', v)}
            />

            <FilterDropdown
              label="All Collections"
              value={collectionFilter}
              options={collectionOptions}
              onChange={v => setParam('collection', v)}
            />

            {(agentFilter || collectionFilter) && (
              <button
                onClick={() => router.push('/analytics')}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-1"
              >
                Clear all
              </button>
            )}

            {/* Refresh button + last updated */}
            <div className="ml-auto flex items-center gap-3">
              {refreshing ? (
                <span className="text-[10px] font-mono text-muted-foreground/50 animate-pulse hidden sm:inline">
                  Refreshing...
                </span>
              ) : lastUpdatedAt ? (
                <span className="text-[10px] font-mono text-muted-foreground/40 hidden sm:inline">
                  Updated {fmtRelative(lastUpdatedAt)}
                </span>
              ) : null}
              <button
                onClick={handleRefresh}
                aria-label="Refresh analytics"
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium border transition-all',
                  'border-border/50 bg-card hover:bg-accent/5 text-muted-foreground hover:text-foreground'
                )}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>

          {/* Active filter chips */}
          {(agentFilter || collectionFilter) && (
            <div className="px-6 pb-2 flex items-center gap-2 flex-wrap">
              {agentFilter && (
                <span className="bg-accent/10 text-accent border border-accent/20 rounded-full px-2.5 py-0.5 text-[11px] font-medium flex items-center gap-1">
                  Agent: {AGENT_CATALOG[categorize(agentFilter)]?.label ?? agentFilter}
                  <button
                    onClick={() => setParam('agent', '')}
                    aria-label="Clear agent filter"
                    className="hover:opacity-70 transition-opacity leading-none ml-0.5"
                  >×</button>
                </span>
              )}
              {collectionFilter && (
                <span className="bg-accent/10 text-accent border border-accent/20 rounded-full px-2.5 py-0.5 text-[11px] font-medium flex items-center gap-1">
                  Collection: {collectionFilter}
                  <button
                    onClick={() => setParam('collection', '')}
                    aria-label="Clear collection filter"
                    className="hover:opacity-70 transition-opacity leading-none ml-0.5"
                  >×</button>
                </span>
              )}
            </div>
          )}

          {/* Auto-refresh progress bar */}
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-muted/20 pointer-events-none">
            <div
              className="h-full bg-accent/40 transition-[width] duration-1000 ease-linear"
              style={{ width: refreshing ? '100%' : `${refreshProgress}%` }}
            />
          </div>
        </div>

        <div className="flex-1 px-6 py-5 space-y-6 max-w-[1200px] w-full mx-auto">

          {/* Error state */}
          {error && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
              {error}
            </div>
          )}

          {/* ── Summary cards ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <SummaryCard
              icon={Zap}
              label="Total Calls"
              value={summary?.total_calls ?? null}
              loading={loading}
              accent
              index={0}
              sparklineData={sparklineData}
              trendPct={trendPct}
            />
            <SummaryCard
              icon={BookOpen}
              label="Unique Skills"
              value={summary?.unique_skills ?? null}
              loading={loading}
              index={1}
            />
            <SummaryCard
              icon={Users}
              label="Unique Agents"
              value={summary?.unique_agents ?? null}
              loading={loading}
              index={2}
            />
            <SummaryCard
              icon={Activity}
              label="Calls Today"
              value={summary?.calls_today ?? null}
              loading={loading}
              index={3}
            />
            <SummaryCard
              icon={TrendingUp}
              label="Most Called"
              value={summary?.most_called_skill ?? null}
              loading={loading}
              index={4}
            />
          </div>

          {/* ── Leaderboard + Agent Breakdown ──────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Skill Leaderboard */}
            <section className="group rounded-xl border border-border/50 border-l-2 border-l-transparent hover:border-l-accent/50 bg-card overflow-hidden transition-colors">
              <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2 bg-gradient-to-r from-card to-muted/10">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Skill Leaderboard</h2>
              </div>

              {loading ? (
                <div className="p-4 space-y-2.5">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : skillCalls.length === 0 ? (
                <LeaderboardEmpty />
              ) : (
                <div className="divide-y divide-border/30 max-h-[420px] overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-border/60">
                  {skillCalls.map((s, i) => {
                    const barWidth = maxSkillCalls > 0 ? (s.call_count / maxSkillCalls) * 100 : 0
                    const rankBadge = i === 0
                      ? <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-500 text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
                      : i === 1
                      ? <span className="w-5 h-5 rounded-full bg-slate-400/20 text-slate-400 text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
                      : i === 2
                      ? <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-500 text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
                      : <span className="text-[11px] font-mono text-muted-foreground/50 w-5 shrink-0 text-right">{i + 1}</span>
                    return (
                      <button
                        key={s.slug}
                        onClick={() => router.push(`/skills/${s.slug}`)}
                        className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-accent/4 transition-colors text-left group/row"
                      >
                        {rankBadge}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[12px] font-medium font-mono text-foreground truncate group-hover/row:text-accent transition-colors">
                              {s.slug}
                            </span>
                            <span className="text-[12px] font-semibold tabular-nums text-foreground shrink-0">
                              {s.call_count.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1 rounded-full bg-muted/40 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-accent/60"
                                style={{
                                  width: ldrMounted ? `${barWidth}%` : '0%',
                                  transition: `width ${300 + i * 40}ms ease-out`,
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground/50 shrink-0 w-16 text-right">
                              {fmtRelative(s.last_called_at)}
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-transparent group-hover/row:text-muted-foreground/40 transition-all" />
                      </button>
                    )
                  })}
                </div>
              )}
            </section>

            {/* Agent Breakdown */}
            <section className="group rounded-xl border border-border/50 border-l-2 border-l-transparent hover:border-l-accent/50 bg-card overflow-hidden transition-colors">
              <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2 bg-gradient-to-r from-card to-muted/10">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Agent Breakdown</h2>
                {agents.length > 0 && (
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => setAgentView('bars')}
                      aria-label="Bar chart view"
                      className={cn(
                        'p-1 rounded transition-colors',
                        agentView === 'bars' ? 'text-accent bg-accent/10' : 'text-muted-foreground/50 hover:text-muted-foreground'
                      )}
                    >
                      <BarChart2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setAgentView('donut')}
                      aria-label="Donut chart view"
                      className={cn(
                        'p-1 rounded transition-colors',
                        agentView === 'donut' ? 'text-accent bg-accent/10' : 'text-muted-foreground/50 hover:text-muted-foreground'
                      )}
                    >
                      <PieChartIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {loading ? (
                <div className="p-4 space-y-3">
                  {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : agents.length === 0 ? (
                <AgentBreakdownEmpty />
              ) : agentView === 'donut' ? (
                <div className="p-4">
                  <div className="relative">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={donutData}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={85}
                          dataKey="value"
                          isAnimationActive={true}
                          animationDuration={600}
                        >
                          {donutData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomDonutTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Center label */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="text-[20px] font-semibold font-mono text-foreground">
                        {totalAgentCalls.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  {/* Donut legend */}
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 justify-center">
                    {donutData.map((entry, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                        <span className="text-[11px] text-muted-foreground">{entry.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {agents.map(a => {
                    const cat = categorize(a.agent_name)
                    const info = AGENT_CATALOG[cat] ?? AGENT_CATALOG.other
                    return (
                      <div key={a.agent_name} className="space-y-1">
                        <div className="flex items-center justify-between text-[12px]">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: info.color }} />
                            <span className="font-medium text-foreground">{info.label}</span>
                            <span className="text-muted-foreground/50 font-mono text-[10px]">{a.agent_name}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-semibold tabular-nums text-foreground">{a.call_count.toLocaleString()}</span>
                            <span className="text-muted-foreground/50 w-9 text-right">{a.pct.toFixed(1)}%</span>
                          </div>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${a.pct}%`, backgroundColor: info.color }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          </div>

          {/* ── Activity Timeline ───────────────────────────────────────────── */}
          <section className="group rounded-xl border border-border/50 border-l-2 border-l-transparent hover:border-l-accent/50 bg-card overflow-hidden transition-colors">
            <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2 bg-gradient-to-r from-card to-muted/10">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Activity Timeline</h2>
              {!loading && timeline.length > 0 && (
                <span className="ml-auto text-[11px] text-muted-foreground/50">{timeline.length} days</span>
              )}
            </div>

            {loading ? (
              <div className="p-5">
                <Skeleton className="h-24 w-full" />
              </div>
            ) : timeline.length === 0 ? (
              <TimelineEmpty />
            ) : (
              <div className="px-2 pt-4 pb-3">
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={timeline} margin={{ top: 0, right: 4, left: 4, bottom: 0 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border)"
                      opacity={0.4}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(val: string, idx: number) => {
                        const step = timeline.length > 60 ? 14 : timeline.length > 30 ? 7 : timeline.length > 14 ? 3 : 1
                        return idx % step === 0 ? fmtDate(val) : ''
                      }}
                      tick={{ fontSize: 9, fontFamily: 'var(--font-mono, monospace)', fill: 'var(--muted-foreground)', fillOpacity: 0.4 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis hide={true} />
                    <Tooltip
                      content={<CustomTimelineTooltip />}
                      cursor={{ fill: 'var(--accent)', fillOpacity: 0.05 }}
                    />
                    <Bar
                      dataKey="call_count"
                      fill="var(--accent)"
                      fillOpacity={0.6}
                      radius={[2, 2, 0, 0]}
                      isAnimationActive={true}
                      animationDuration={600}
                      activeBar={{ fillOpacity: 0.9 }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* ── Collections + Live Connections ──────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pb-6">

            {/* Collection Usage */}
            <section className="group rounded-xl border border-border/50 border-l-2 border-l-transparent hover:border-l-accent/50 bg-card overflow-hidden transition-colors">
              <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2 bg-gradient-to-r from-card to-muted/10">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Collection Usage</h2>
                {!loading && collections.length > 0 && (
                  <span className="ml-auto text-[11px] text-muted-foreground/50">
                    {totalCollectionCalls.toLocaleString()} calls across {collections.length}
                  </span>
                )}
              </div>

              {loading ? (
                <div className="p-4 space-y-3">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : collections.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center px-4">
                  <BookOpen className="h-7 w-7 text-muted-foreground/20" />
                  <p className="text-[13px] text-muted-foreground/50">No collection data yet</p>
                </div>
              ) : showTreemap ? (
                <div className="p-4">
                  <div
                    className="grid gap-2"
                    style={{ gridTemplateColumns: treemapCols }}
                  >
                    {collections.map((c, i) => {
                      const label = c.scope ?? 'No filter'
                      const color = TILE_COLORS[label.charCodeAt(0) % TILE_COLORS.length]
                      const pct = totalCollectionCalls > 0
                        ? ((c.call_count / totalCollectionCalls) * 100).toFixed(1)
                        : '0'
                      return (
                        <div
                          key={i}
                          className="group/tile relative rounded-lg flex flex-col items-center justify-center p-2 min-h-[80px] text-center cursor-default transition-all hover:brightness-110"
                          style={{ backgroundColor: `${color}18`, border: `1px solid ${color}30` }}
                          title={`${label}: ${c.call_count} calls (${pct}%)`}
                        >
                          <span
                            className="text-[10px] font-mono font-medium truncate w-full text-center"
                            style={{ color }}
                          >
                            {label}
                          </span>
                          <span className="text-[13px] font-semibold tabular-nums" style={{ color }}>
                            {c.call_count.toLocaleString()}
                          </span>
                          <span
                            className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/80 opacity-0 group-hover/tile:opacity-100 transition-opacity text-[11px] font-mono"
                            style={{ color }}
                          >
                            {pct}%
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="p-4 space-y-2.5">
                  {collections.map((c, i) => {
                    const label = c.scope ?? 'No filter'
                    const barWidth = maxCollection > 0 ? (c.call_count / maxCollection) * 100 : 0
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between text-[12px]">
                          <span className={cn('font-medium', c.scope ? 'text-foreground font-mono' : 'text-muted-foreground italic')}>
                            {label}
                          </span>
                          <span className="font-semibold tabular-nums text-foreground">
                            {c.call_count.toLocaleString()}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-accent/50 transition-all duration-500"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* Live Connections */}
            <section className="group rounded-xl border border-border/50 border-l-2 border-l-transparent hover:border-l-accent/50 bg-card overflow-hidden transition-colors">
              <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2 bg-gradient-to-r from-card to-muted/10">
                <Radio className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Live Connections</h2>
                {mcpStatus && (
                  <span className="ml-auto flex items-center gap-1.5 text-[11px] text-emerald-500 font-medium">
                    <span className="relative w-3 h-3 flex items-center justify-center shrink-0">
                      <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-40" />
                      <span className="absolute w-2 h-2 rounded-full bg-emerald-500" />
                    </span>
                    {mcpStatus.active_connections} active
                    {mcpStatus.uptime_seconds > 0 && (
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground/60 bg-muted/30 rounded px-1.5 py-0.5">
                        {fmtDuration(mcpStatus.uptime_seconds)}
                      </span>
                    )}
                  </span>
                )}
                {mcpError && (
                  <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground/40">
                    <WifiOff className="h-3 w-3" />
                    MCP offline
                  </span>
                )}
              </div>

              {mcpError ? (
                <div className="flex flex-col items-center gap-2.5 py-10 text-center px-4">
                  <WifiOff className="h-7 w-7 text-muted-foreground/20" />
                  <p className="text-[13px] text-muted-foreground/50">MCP server not reachable</p>
                  <p className="text-[11px] font-mono text-muted-foreground/25">{buildMcpBase()}/status</p>
                </div>
              ) : mcpStatus === null ? (
                <div className="p-4 space-y-2">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : mcpStatus.connections.length === 0 ? (
                <LiveConnectionsEmpty />
              ) : (
                <div className="divide-y divide-border/30">
                  {mcpStatus.connections.slice(0, 8).map(conn => {
                    const cat = categorize(conn.client_name || conn.user_agent)
                    const info = AGENT_CATALOG[cat] ?? AGENT_CATALOG.other
                    const name = conn.client_name || info.label
                    return (
                      <div key={conn.id} className="px-4 py-2.5 flex items-center gap-3">
                        {/* Animated pulse ring */}
                        <span className="relative w-3 h-3 shrink-0 flex items-center justify-center">
                          <span
                            className="absolute inset-0 rounded-full animate-ping opacity-40"
                            style={{ backgroundColor: info.color }}
                          />
                          <span
                            className="absolute w-2 h-2 rounded-full"
                            style={{ backgroundColor: info.color }}
                          />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-[12px] font-medium text-foreground truncate">{name}</p>
                            {conn.proto_version && (
                              <span className="border border-border/40 rounded px-1 text-[9px] font-mono text-muted-foreground/40 shrink-0">
                                {conn.proto_version}
                              </span>
                            )}
                          </div>
                          {conn.scope && (
                            <p className="text-[10px] font-mono text-muted-foreground/50 truncate">
                              scope: {conn.scope}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[11px] tabular-nums text-muted-foreground/70">
                            {conn.call_count} calls
                          </p>
                          {conn.duration_seconds > 0 && (
                            <p className="bg-muted/30 rounded px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/60 mt-0.5 inline-block">
                              {fmtDuration(conn.duration_seconds)}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {mcpStatus.connections.length > 8 && (
                    <div className="px-4 py-2 text-[11px] text-muted-foreground/40 text-center">
                      +{mcpStatus.connections.length - 8} more connections
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  )
}

export default function AnalyticsPage() {
  return (
    <Suspense>
      <AnalyticsContent />
    </Suspense>
  )
}
