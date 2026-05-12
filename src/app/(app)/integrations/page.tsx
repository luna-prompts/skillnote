'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/topbar'
import { AgentListRow } from '@/components/integrations/agent-list-row'
import { ClaudeCodeMark, OpenClawMark } from '@/components/integrations/agent-marks'
import type { ConnectionState } from '@/components/integrations/connector'
import { getApiBaseUrl } from '@/lib/api/client'
import { dispatchJob, useJobPolling, type JobAgent } from '@/lib/cli-jobs'

type AgentId = 'claude-code' | 'openclaw'

interface AgentSnapshot {
  id: AgentId
  state: ConnectionState
  installedAt?: string
  lastCallAt?: string
}

interface SetupAgentStatus {
  agent: AgentId
  state: 'pending' | 'active' | 'idle'
  installed_at: string | null
  last_active_at: string | null
  calls_24h: number
  calls_7d: number
}

const AGENTS: { id: AgentId; label: string; sublabel: string }[] = [
  { id: 'claude-code', label: 'Claude Code', sublabel: 'Anthropic CLI' },
  { id: 'openclaw', label: 'OpenClaw', sublabel: 'Open-source agent runtime' },
]

const ALL_STATES: ConnectionState[] = ['pending', 'connecting', 'active', 'idle']
const POLL_INTERVAL_MS = 5_000

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

  useEffect(() => {
    if (!apiBase) return
    let cancelled = false

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${apiBase}/v1/setup/agents`, { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const rows = (await res.json()) as SetupAgentStatus[]
        if (cancelled) return
        setSnapshots((prev) => {
          const next = { ...prev }
          for (const row of rows) {
            // Preserve optimistic 'connecting' while a bridge job is mid-flight
            if (prev[row.agent]?.state === 'connecting') continue
            next[row.agent] = {
              id: row.agent,
              state: row.state as ConnectionState,
              installedAt: row.installed_at ?? undefined,
              lastCallAt: row.last_active_at ?? undefined,
            }
          }
          return next
        })
      } catch {
        // Network down — leave snapshots untouched; banner surfaces the rest.
      }
    }

    fetchStatus()
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [apiBase])

  const [pendingJob, setPendingJob] = useState<{ agent: AgentId; jobId: string } | null>(null)
  const { job } = useJobPolling(pendingJob?.jobId ?? null)

  useEffect(() => {
    if (!pendingJob || !job) return
    if (job.status === 'succeeded') {
      // Backend install ping will flip state on next poll; in the meantime
      // optimistically mark active so the UI doesn't bounce.
      setSnapshots((prev) => ({
        ...prev,
        [pendingJob.agent]: { ...prev[pendingJob.agent], state: 'active' },
      }))
      toast.success(`${labelOf(pendingJob.agent)} connected`)
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      toast.error(
        `Couldn't dispatch install (${msg.includes('fetch') ? 'backend offline' : msg}). Open "Advanced install" and run the command manually.`,
        { duration: 6000 },
      )
      return false
    }
  }, [])

  const effective = useMemo(() => {
    const apply = (s: AgentSnapshot): AgentSnapshot => {
      const override = overrides[s.id]
      return override ? { ...s, state: override } : s
    }
    return {
      'claude-code': apply(snapshots['claude-code']),
      openclaw: apply(snapshots.openclaw),
    } as Record<AgentId, AgentSnapshot>
  }, [snapshots, overrides])

  // Resolve apiBase fallback so install commands are never empty before hydration
  const base = apiBase || 'http://localhost:8082'
  const installCmd = (id: AgentId) =>
    id === 'claude-code'
      ? `curl -sf ${base}/setup/agent | bash -s -- --agent claude-code`
      : `curl -sf ${base}/setup/openclaw | bash`

  const handleReinstall = (id: AgentId) => {
    toast.info(`Re-running the install for ${labelOf(id)}…`)
    handleConnect(id)
  }

  const handleDisconnect = (id: AgentId) => {
    toast.info(
      `Open ${labelOf(id)} and remove the SkillNote plugin from its config to disconnect.`,
    )
  }

  const markFor = (id: AgentId) =>
    id === 'claude-code' ? <ClaudeCodeMark /> : <OpenClawMark />

  // Partition by state. A 'connecting' agent stays in the "Available" group
  // until the bridge job completes — moving it would feel like premature
  // celebration.
  const installed: typeof AGENTS = []
  const available: typeof AGENTS = []
  for (const agent of AGENTS) {
    const s = effective[agent.id].state
    if (s === 'active' || s === 'idle') {
      installed.push(agent)
    } else {
      available.push(agent)
    }
  }

  return (
    <>
      <TopBar showFab={false} />
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {/* Header — matches Settings page hierarchy */}
          <header className="mb-8">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">
              Integrations
            </h1>
            <p className="text-[13px] text-muted-foreground mt-1">
              Install SkillNote into your AI coding agents.
            </p>
          </header>

          {installed.length > 0 ? (
            <Section
              label="Installed"
              count={installed.length}
              className="mb-6"
            >
              {installed.map((agent) => {
                const snap = effective[agent.id]
                return (
                  <AgentListRow
                    key={agent.id}
                    state={snap.state}
                    agentLabel={agent.label}
                    agentSublabel={agent.sublabel}
                    agentMark={markFor(agent.id)}
                    installCommand={installCmd(agent.id)}
                    installedAt={snap.installedAt}
                    lastCallAt={snap.lastCallAt}
                    onConnectClick={() => handleConnect(agent.id)}
                    onReinstall={() => handleReinstall(agent.id)}
                    onDisconnect={() => handleDisconnect(agent.id)}
                  />
                )
              })}
            </Section>
          ) : null}

          {available.length > 0 ? (
            <Section label="Available" count={available.length}>
              {available.map((agent) => {
                const snap = effective[agent.id]
                return (
                  <AgentListRow
                    key={agent.id}
                    state={snap.state}
                    agentLabel={agent.label}
                    agentSublabel={agent.sublabel}
                    agentMark={markFor(agent.id)}
                    installCommand={installCmd(agent.id)}
                    installedAt={snap.installedAt}
                    lastCallAt={snap.lastCallAt}
                    // When the user has zero installed agents, default the
                    // first available row to open so the install affordance
                    // is immediately visible — no extra click required.
                    defaultOpen={installed.length === 0 && agent === available[0]}
                    onConnectClick={() => handleConnect(agent.id)}
                    onReinstall={() => handleReinstall(agent.id)}
                    onDisconnect={() => handleDisconnect(agent.id)}
                  />
                )
              })}
            </Section>
          ) : null}
        </div>
      </div>

      <DevCycler overrides={overrides} setOverrides={setOverrides} />
    </>
  )
}

function labelOf(id: AgentId): string {
  return id === 'claude-code' ? 'Claude Code' : 'OpenClaw'
}

// ─── Section header + list wrapper ────────────────────────────────────────

function Section({
  label,
  count,
  children,
  className,
}: {
  label: string
  count: number
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </h2>
        <span className="text-[11px] text-muted-foreground/60 tabular-nums">
          {count}
        </span>
      </div>
      <ul className="space-y-2">{children}</ul>
    </section>
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
