'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { TopBar } from '@/components/layout/topbar'
import { AgentRow } from '@/components/integrations/agent-row'
import { ClaudeCodeMark, OpenClawMark } from '@/components/integrations/agent-marks'
import type { AgentStats } from '@/components/integrations/action-panel'
import type { ConnectionState } from '@/components/integrations/connector'
import { getApiBaseUrl } from '@/lib/api/client'
import { dispatchJob, useJobPolling, type JobAgent } from '@/lib/cli-jobs'

type AgentId = 'claude-code' | 'openclaw'

const ACTIVE_THRESHOLD_HOURS = 24
const IDLE_THRESHOLD_DAYS = 7

interface AgentSnapshot {
  id: AgentId
  state: ConnectionState
  installedAt?: string
  stats?: AgentStats
}

const AGENTS: { id: AgentId; label: string; sublabel: string }[] = [
  { id: 'claude-code', label: 'Claude Code', sublabel: 'Anthropic' },
  { id: 'openclaw', label: 'OpenClaw', sublabel: 'open source' },
]

const MOCK_STATS: AgentStats = {
  lastCallAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  calls7d: 47,
  uniqueSkills7d: 8,
  timeline7d: [0.1, 0.25, 0.55, 0.9, 0.7, 1.0, 0.35],
  topSkills: [
    { slug: 'error-handling', calls: 12, lastAt: new Date(Date.now() - 60_000).toISOString() },
    { slug: 'testing-guide', calls: 8, lastAt: new Date(Date.now() - 60 * 60_000).toISOString() },
    { slug: 'code-review-list', calls: 6, lastAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString() },
  ],
}

const ALL_STATES: ConnectionState[] = ['pending', 'connecting', 'installed', 'active', 'idle']

export default function IntegrationsPage() {
  const [apiBase, setApiBase] = useState<string>('')
  const [selected, setSelected] = useState<AgentId>('claude-code')
  const [overrides, setOverrides] = useState<Partial<Record<AgentId, ConnectionState>>>({})
  const [snapshots, setSnapshots] = useState<Record<AgentId, AgentSnapshot>>({
    'claude-code': { id: 'claude-code', state: 'pending' },
    openclaw: { id: 'openclaw', state: 'pending' },
  })

  useEffect(() => {
    setApiBase(getApiBaseUrl())
  }, [])

  useEffect(() => {
    if (!apiBase) return
    let cancelled = false

    const probe = async (id: AgentId, url: string, extractTs: (d: unknown) => string | null) => {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        const ts = extractTs(data)
        if (!ts || cancelled) return
        const ageMs = Date.now() - new Date(ts).getTime()
        const state: ConnectionState =
          ageMs < ACTIVE_THRESHOLD_HOURS * 3600_000
            ? 'active'
            : ageMs < IDLE_THRESHOLD_DAYS * 86400_000
              ? 'idle'
              : 'pending'
        setSnapshots((prev) => ({
          ...prev,
          [id]: {
            id,
            state,
            stats:
              state === 'active' || state === 'idle'
                ? { ...MOCK_STATS, lastCallAt: ts }
                : undefined,
          },
        }))
      } catch {
        // network errors leave state at 'pending'
      }
    }

    probe(
      'claude-code',
      `${apiBase}/v1/analytics/skill-calls?limit=1`,
      (d) => {
        const arr = d as { last_called_at?: string }[]
        return Array.isArray(arr) && arr.length > 0 ? arr[0]?.last_called_at ?? null : null
      },
    )

    probe(
      'openclaw',
      `${apiBase}/v1/openclaw/usage?limit=1`,
      (d) => {
        const obj = d as { events?: { created_at?: string }[] }
        return obj?.events?.[0]?.created_at ?? null
      },
    )

    return () => {
      cancelled = true
    }
  }, [apiBase])

  const [pendingJob, setPendingJob] = useState<{ agent: AgentId; jobId: string } | null>(null)
  const { job } = useJobPolling(pendingJob?.jobId ?? null)

  useEffect(() => {
    if (!pendingJob || !job) return
    if (job.status === 'succeeded') {
      setSnapshots((prev) => ({
        ...prev,
        [pendingJob.agent]: { ...prev[pendingJob.agent], state: 'installed' },
      }))
      toast.success(`${labelOf(pendingJob.agent)} install complete — try a task to activate`)
      setPendingJob(null)
    } else if (job.status === 'failed' || job.status === 'cancelled') {
      toast.error(`Install failed. Try the manual command in Advanced.`)
      setPendingJob(null)
    }
  }, [job, pendingJob])

  const handleConnect = useCallback(async (agent: AgentId): Promise<boolean> => {
    try {
      const { id } = await dispatchJob({ type: 'connect', agent: agent as JobAgent })
      setPendingJob({ agent, jobId: id })
      setSnapshots((prev) => ({
        ...prev,
        [agent]: { ...prev[agent], state: 'connecting' },
      }))
      return true
    } catch {
      return false
    }
  }, [])

  const effective = useMemo(() => {
    const apply = (s: AgentSnapshot): AgentSnapshot => {
      const override = overrides[s.id]
      if (!override) return s
      if (override === 'active' || override === 'idle') {
        return { ...s, state: override, stats: MOCK_STATS }
      }
      return { ...s, state: override }
    }
    return {
      'claude-code': apply(snapshots['claude-code']),
      openclaw: apply(snapshots.openclaw),
    } as Record<AgentId, AgentSnapshot>
  }, [snapshots, overrides])

  const installCmd = (id: AgentId) =>
    id === 'claude-code'
      ? `curl -sf ${apiBase || 'http://localhost:8082'}/setup/agent | bash -s -- --agent claude-code`
      : `curl -sf ${apiBase || 'http://localhost:8082'}/setup/openclaw | bash`

  const markFor = (id: AgentId) =>
    id === 'claude-code' ? <ClaudeCodeMark /> : <OpenClawMark />

  const current = AGENTS.find((a) => a.id === selected)!
  const currentSnapshot = effective[selected]

  return (
    <>
      <TopBar showFab={false} />
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-10 md:py-14">
          {/* Header */}
          <header className="text-center mb-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70 mb-2">
              Integrations
            </p>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
              Connect your agent
            </h1>
            <p className="mt-2 text-[14px] text-muted-foreground">
              Wire SkillNote into your AI coding agent in about 30 seconds.
            </p>
          </header>

          {/* Agent tab switcher */}
          <AgentTabs
            agents={AGENTS.map((a) => ({
              ...a,
              state: effective[a.id].state,
              mark: markFor(a.id),
            }))}
            selected={selected}
            onSelect={setSelected}
            className="mb-6"
          />

          {/* Single selected agent — the canvas */}
          <AgentRow
            state={currentSnapshot.state}
            agentLabel={current.label}
            agentSublabel={current.sublabel}
            agentMark={markFor(selected)}
            installCommand={installCmd(selected)}
            installedAt={currentSnapshot.installedAt}
            stats={currentSnapshot.stats}
            onConnectClick={() => handleConnect(selected)}
          />
        </div>
      </div>

      <DevCycler overrides={overrides} setOverrides={setOverrides} />
    </>
  )
}

function labelOf(id: AgentId): string {
  return id === 'claude-code' ? 'Claude Code' : 'OpenClaw'
}

// ─── Tab switcher ──────────────────────────────────────────────────────────

interface TabAgent {
  id: AgentId
  label: string
  sublabel: string
  state: ConnectionState
  mark: React.ReactNode
}

function AgentTabs({
  agents,
  selected,
  onSelect,
  className,
}: {
  agents: TabAgent[]
  selected: AgentId
  onSelect: (id: AgentId) => void
  className?: string
}) {
  return (
    <div className={cn('flex justify-center', className)}>
      <div
        role="tablist"
        aria-label="Choose agent"
        className={cn(
          'inline-flex p-1 rounded-xl border border-border bg-card',
          'shadow-[0_1px_2px_rgba(0,0,0,0.03)]',
        )}
      >
        {agents.map((a) => {
          const active = a.id === selected
          return (
            <button
              key={a.id}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(a.id)}
              className={cn(
                'inline-flex items-center gap-2.5 px-4 py-2 rounded-lg',
                'text-[13px] font-medium transition-all duration-200',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
              )}
            >
              <span className="shrink-0 inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded">
                <TabMark>{a.mark}</TabMark>
              </span>
              <span>{a.label}</span>
              <StateChip state={a.state} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Forces any mark variant (img or div+svg) into a uniform 20px square so
// the tab strip reads as a clean row.
function TabMark({ children }: { children: React.ReactNode }) {
  return (
    <span className="[&>*]:!w-5 [&>*]:!h-5 [&_svg]:!w-3 [&_svg]:!h-3 inline-flex items-center justify-center">
      {children}
    </span>
  )
}

function StateChip({ state }: { state: ConnectionState }) {
  const meta =
    state === 'active'
      ? { label: 'Connected', dot: 'bg-emerald-500', wrap: 'text-emerald-600 dark:text-emerald-400' }
      : state === 'idle'
        ? { label: 'Idle', dot: 'bg-emerald-500/40', wrap: 'text-muted-foreground' }
        : state === 'installed'
          ? { label: 'Waiting', dot: 'bg-amber-500', wrap: 'text-amber-600 dark:text-amber-400' }
          : state === 'connecting'
            ? { label: 'Connecting', dot: 'bg-emerald-500 motion-safe:animate-pulse', wrap: 'text-emerald-600 dark:text-emerald-400' }
            : { label: 'Not connected', dot: 'bg-muted-foreground/40', wrap: 'text-muted-foreground' }

  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', meta.wrap)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  )
}

// ─── Dev cycler ────────────────────────────────────────────────────────────

function DevCycler({
  overrides,
  setOverrides,
}: {
  overrides: Partial<Record<AgentId, ConnectionState>>
  setOverrides: (v: Partial<Record<AgentId, ConnectionState>>) => void
}) {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setEnabled(new URLSearchParams(window.location.search).get('dev') === '1')
  }, [])

  if (!enabled) return null

  const cycle = (id: AgentId) => {
    const current = overrides[id] ?? 'pending'
    const idx = ALL_STATES.indexOf(current)
    const next = ALL_STATES[(idx + 1) % ALL_STATES.length]
    setOverrides({ ...overrides, [id]: next })
  }

  const reset = (id: AgentId) => {
    const copy = { ...overrides }
    delete copy[id]
    setOverrides(copy)
  }

  const Btn = ({ id, label }: { id: AgentId; label: string }) => (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <button
        onClick={() => cycle(id)}
        className="px-2 py-0.5 rounded-md bg-foreground text-background text-[11px] font-mono hover:opacity-90"
      >
        {overrides[id] ?? 'auto'}
      </button>
      {overrides[id] && (
        <button
          onClick={() => reset(id)}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      )}
    </div>
  )

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-1.5 rounded-lg border border-border bg-card/95 backdrop-blur-sm p-2.5 shadow-md">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
        Dev state cycler
      </p>
      <Btn id="claude-code" label="claude" />
      <Btn id="openclaw" label="openclaw" />
    </div>
  )
}
