'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { TopBar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'
import { getApiBaseUrl } from '@/lib/api/client'
import {
  Zap, BookOpen, Users, Activity, TrendingUp, Radio, WifiOff,
  ChevronDown,
} from 'lucide-react'
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

// ─── helpers ──────────────────────────────────────────────────────────────────

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

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted/40', className)} />
}

// ─── Simple dropdown ──────────────────────────────────────────────────────────

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

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  icon: Icon,
  label,
  value,
  loading,
  accent,
}: {
  icon: React.ElementType
  label: string
  value: string | number | null
  loading: boolean
  accent?: boolean
}) {
  return (
    <div className={cn(
      'rounded-xl border border-border/50 bg-card px-4 py-3.5 flex flex-col gap-1.5',
      accent && 'border-accent/20 bg-accent/3'
    )}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={cn('h-[15px] w-[15px] shrink-0', accent && 'text-accent')} />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <p className={cn('text-[22px] font-semibold tabular-nums leading-none', accent ? 'text-accent' : 'text-foreground')}>
          {value ?? '—'}
        </p>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

function AnalyticsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // Filter state from URL
  const days = searchParams.get('days') ? Number(searchParams.get('days')) : 30
  const agentFilter = searchParams.get('agent') ?? ''
  const collectionFilter = searchParams.get('collection') ?? ''

  // Data state
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [skillCalls, setSkillCalls] = useState<SkillCallStat[]>([])
  const [agents, setAgents] = useState<AgentStat[]>([])
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [collections, setCollections] = useState<CollectionStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // MCP live connections state
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, agentFilter, collectionFilter])

  useEffect(() => {
    setLoading(true)
    fetchAll()
    const id = setInterval(fetchAll, 30000)
    return () => clearInterval(id)
  }, [fetchAll])

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

  // URL param helpers
  function setParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (value === '' || value === '0' && key !== 'days') {
      p.delete(key)
    } else {
      p.set(key, value)
    }
    router.push(`/analytics?${p.toString()}`)
  }

  // Build dropdown options from data
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
  const maxTimeline = timeline.reduce((m, t) => Math.max(m, t.call_count), 0)
  const maxCollection = collections.reduce((m, c) => Math.max(m, c.call_count), 0)

  return (
    <div className="flex flex-col min-h-screen">
      <TopBar showFab={false} />

      {/* Filter bar */}
      <div className="sticky top-0 z-30 border-b border-border/50 bg-background/90 backdrop-blur-sm">
        <div className="px-6 py-2.5 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mr-1">Filter:</span>

          {/* Time range */}
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
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 px-6 py-5 space-y-6 max-w-[1200px] w-full mx-auto">

        {/* Error state */}
        {error && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
            {error}
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <SummaryCard
            icon={Zap}
            label="Total Calls"
            value={summary?.total_calls ?? null}
            loading={loading}
            accent
          />
          <SummaryCard
            icon={BookOpen}
            label="Unique Skills"
            value={summary?.unique_skills ?? null}
            loading={loading}
          />
          <SummaryCard
            icon={Users}
            label="Unique Agents"
            value={summary?.unique_agents ?? null}
            loading={loading}
          />
          <SummaryCard
            icon={Activity}
            label="Calls Today"
            value={summary?.calls_today ?? null}
            loading={loading}
          />
          <SummaryCard
            icon={TrendingUp}
            label="Most Called"
            value={summary?.most_called_skill ?? null}
            loading={loading}
          />
        </div>

        {/* Main grid: leaderboard + agent breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Skill Leaderboard */}
          <section className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-[13px] font-semibold text-foreground">Skill Leaderboard</h2>
            </div>

            {loading ? (
              <div className="p-4 space-y-2.5">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
              </div>
            ) : skillCalls.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center px-4">
                <BookOpen className="h-8 w-8 text-muted-foreground/20" />
                <p className="text-[13px] text-muted-foreground/50">No skill calls recorded yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {skillCalls.map((s, i) => {
                  const barWidth = maxSkillCalls > 0 ? (s.call_count / maxSkillCalls) * 100 : 0
                  return (
                    <button
                      key={s.slug}
                      onClick={() => router.push(`/skills/${s.slug}`)}
                      className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-accent/4 transition-colors text-left group"
                    >
                      <span className="text-[11px] font-mono text-muted-foreground/50 w-5 shrink-0 text-right">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[12px] font-medium font-mono text-foreground truncate group-hover:text-accent transition-colors">
                            {s.slug}
                          </span>
                          <span className="text-[12px] font-semibold tabular-nums text-foreground shrink-0">
                            {s.call_count.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1 rounded-full bg-muted/40 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-accent/60 transition-all duration-500"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground/50 shrink-0 w-16 text-right">
                            {fmtRelative(s.last_called_at)}
                          </span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* Agent Breakdown */}
          <section className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-[13px] font-semibold text-foreground">Agent Breakdown</h2>
            </div>

            {loading ? (
              <div className="p-4 space-y-3">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : agents.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center px-4">
                <Users className="h-8 w-8 text-muted-foreground/20" />
                <p className="text-[13px] text-muted-foreground/50">No agent data yet</p>
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
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: info.color }}
                          />
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

        {/* Activity Timeline */}
        <section className="rounded-xl border border-border/50 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-[13px] font-semibold text-foreground">Activity Timeline</h2>
            {!loading && timeline.length > 0 && (
              <span className="ml-auto text-[11px] text-muted-foreground/50">{timeline.length} days</span>
            )}
          </div>

          {loading ? (
            <div className="p-5">
              <Skeleton className="h-24 w-full" />
            </div>
          ) : timeline.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center px-4">
              <Activity className="h-8 w-8 text-muted-foreground/20" />
              <p className="text-[13px] text-muted-foreground/50">No timeline data yet</p>
            </div>
          ) : (
            <div className="px-4 pt-4 pb-5">
              {/* Bar chart */}
              <div className="flex items-end gap-0.5 h-28 mb-2">
                {timeline.map(pt => {
                  const heightPct = maxTimeline > 0 ? (pt.call_count / maxTimeline) * 100 : 0
                  const minH = pt.call_count === 0 ? 2 : Math.max(2, heightPct)
                  return (
                    <div
                      key={pt.date}
                      className="group relative flex-1 flex flex-col items-center justify-end"
                      title={`${pt.date}: ${pt.call_count} calls`}
                    >
                      <div
                        className="w-full rounded-t-sm bg-accent/50 group-hover:bg-accent transition-colors"
                        style={{ height: `${minH}%` }}
                      />
                    </div>
                  )
                })}
              </div>

              {/* Date labels — show every N-th to avoid crowding */}
              {(() => {
                const step = timeline.length > 60 ? 14 : timeline.length > 30 ? 7 : timeline.length > 14 ? 3 : 1
                return (
                  <div className="flex gap-0.5">
                    {timeline.map((pt, i) => (
                      <div key={pt.date} className="flex-1 flex justify-center">
                        {i % step === 0 ? (
                          <span className="text-[9px] text-muted-foreground/40 truncate" style={{ writingMode: 'horizontal-tb' }}>
                            {fmtDate(pt.date)}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}
        </section>

        {/* Bottom row: collections + live connections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pb-6">

          {/* Collection Usage */}
          <section className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-[13px] font-semibold text-foreground">Collection Usage</h2>
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
          <section className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
              <Radio className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-[13px] font-semibold text-foreground">Live Connections</h2>
              {mcpStatus && (
                <span className="ml-auto flex items-center gap-1.5 text-[11px] text-emerald-500 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {mcpStatus.active_connections} active
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
              <div className="flex flex-col items-center gap-2 py-10 text-center px-4">
                <Radio className="h-7 w-7 text-muted-foreground/20" />
                <p className="text-[13px] text-muted-foreground/50">No active connections</p>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {mcpStatus.connections.slice(0, 8).map(conn => {
                  const cat = categorize(conn.client_name || conn.user_agent)
                  const info = AGENT_CATALOG[cat] ?? AGENT_CATALOG.other
                  const name = conn.client_name || info.label
                  return (
                    <div key={conn.id} className="px-4 py-2.5 flex items-center gap-3">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: info.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-foreground truncate">{name}</p>
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
  )
}

export default function AnalyticsPage() {
  return (
    <Suspense>
      <AnalyticsContent />
    </Suspense>
  )
}
