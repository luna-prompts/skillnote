'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
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

// ─── Dev-mode state cycler ──────────────────────────────────────────────────
// Click the small badge in the bottom-right to walk through every state.
// Hidden in production builds.

const ALL_STATES: ConnectionState[] = ['pending', 'connecting', 'installed', 'active', 'idle']

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

export default function IntegrationsPage() {
  const [apiBase, setApiBase] = useState<string>('')
  const [overrides, setOverrides] = useState<Partial<Record<AgentId, ConnectionState>>>({})
  const [snapshots, setSnapshots] = useState<Record<AgentId, AgentSnapshot>>({
    'claude-code': { id: 'claude-code', state: 'pending' },
    openclaw: { id: 'openclaw', state: 'pending' },
  })

  useEffect(() => {
    setApiBase(getApiBaseUrl())
  }, [])

  // Real connection-state probes — read recency from existing analytics
  // endpoints. This is the "minimum viable" detection while the proper
  // /v1/setup/agents endpoint isn't wired up yet.
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
            stats: state === 'active' || state === 'idle' ? { ...MOCK_STATS, lastCallAt: ts } : undefined,
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

  // Bridge-based one-click connect (uses the existing CLI job pipeline)
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

  const handleConnect = useCallback(
    async (agent: AgentId): Promise<boolean> => {
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
    },
    [],
  )

  // Apply dev overrides (if any) on top of detected snapshots
  const effective = useMemo(() => {
    const apply = (s: AgentSnapshot): AgentSnapshot => {
      const override = overrides[s.id]
      if (!override) return s
      // When overriding to active/idle, attach mock stats so the panel renders.
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

  const claudeInstallCmd = `curl -sf ${apiBase || 'http://localhost:8082'}/setup/agent | bash -s -- --agent claude-code`
  const openclawInstallCmd = `curl -sf ${apiBase || 'http://localhost:8082'}/setup/openclaw | bash`

  return (
    <>
      <TopBar showFab={false} />
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-10 md:py-14">
          {/* Header */}
          <header className="text-center mb-10">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
              Connect
            </h1>
            <p className="mt-2 text-[14px] text-muted-foreground">
              Wire your AI agents into SkillNote.
            </p>
          </header>

          <div className="space-y-6">
            <AgentRow
              state={effective['claude-code'].state}
              agentLabel="Claude Code"
              agentSublabel="Anthropic"
              agentMark={<ClaudeCodeMark />}
              installCommand={claudeInstallCmd}
              installedAt={effective['claude-code'].installedAt}
              stats={effective['claude-code'].stats}
              onConnectClick={() => handleConnect('claude-code')}
            />
            <AgentRow
              state={effective.openclaw.state}
              agentLabel="OpenClaw"
              agentSublabel="open source"
              agentMark={<OpenClawMark />}
              installCommand={openclawInstallCmd}
              installedAt={effective.openclaw.installedAt}
              stats={effective.openclaw.stats}
              onConnectClick={() => handleConnect('openclaw')}
            />
          </div>
        </div>
      </div>

      {/* Dev-only state cycler (only renders when ?dev=1 is in URL) */}
      <DevCycler overrides={overrides} setOverrides={setOverrides} />
    </>
  )
}

function labelOf(id: AgentId): string {
  return id === 'claude-code' ? 'Claude Code' : 'OpenClaw'
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
