'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/topbar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AgentCard } from '@/components/integrations/agent-card'
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

interface AgentMeta {
  id: AgentId
  label: string
  sublabel: string
  description: string
  platforms: string[]
  badge?: 'official' | 'new' | null
}

// Catalog metadata for the discover view. Sublabel is the short
// attribution; description is the one-liner shown when the row expands.
// Platforms is a quick-glance compatibility row.
const AGENTS: AgentMeta[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    sublabel: 'Anthropic CLI',
    description:
      "Anthropic's official CLI for agentic coding workflows. Skills load automatically per session via the SkillNote plugin.",
    platforms: ['macOS', 'Linux', 'Windows'],
    badge: 'official',
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    sublabel: 'Open-source agent runtime',
    description:
      'Self-hosted coding agent. The SkillNote skill syncs your registry continuously and reports back which skills the agent used.',
    platforms: ['macOS', 'Linux'],
    badge: 'official',
  },
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
  // Flips true after the first successful /v1/setup/agents fetch so the
  // default-tab resolver below doesn't race the network.
  const [hydrated, setHydrated] = useState(false)
  // Tab is uncontrolled initially — we resolve the default *after* the first
  // fetch so returning users with connections land on "Connected", and brand
  // new users land on "Browse".
  const [activeTab, setActiveTab] = useState<'browse' | 'connected' | null>(null)

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
        setHydrated(true)
      } catch {
        // network down — banner handles it. Still mark hydrated so the UI
        // doesn't hang waiting for a fetch that will never succeed.
        setHydrated(true)
      }
    }

    fetchStatus()
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [apiBase])

  // ── Bridge connect flow ──────────────────────────────────────────────────
  const [pendingJob, setPendingJob] = useState<{ agent: AgentId; jobId: string } | null>(null)
  const { job } = useJobPolling(pendingJob?.jobId ?? null)

  useEffect(() => {
    if (!pendingJob || !job) return
    if (job.status === 'succeeded') {
      setSnapshots((prev) => ({
        ...prev,
        [pendingJob.agent]: { ...prev[pendingJob.agent], state: 'active' },
      }))
      // No tab switch — the wire's green check inside the expanded row is
      // the visual confirmation. Auto-navigating felt like the page yanked
      // out from under the user.
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

  const base = apiBase || 'http://localhost:8082'
  // Canonical bash one-liner per agent. macOS + Linux execute it directly;
  // Windows prefixes `wsl ` because the install scripts only run inside a
  // POSIX shell. The Advanced drawer explains the WSL caveat to the user.
  const baseCmd = (id: AgentId) =>
    id === 'claude-code'
      ? `curl -sf ${base}/setup/agent | bash -s -- --agent claude-code`
      : `curl -sf ${base}/setup/openclaw | bash`

  const installCmd = (id: AgentId) => baseCmd(id)

  const platformCmds = (id: AgentId): Record<'macos' | 'linux' | 'windows', string> => {
    const cmd = baseCmd(id)
    return { macos: cmd, linux: cmd, windows: `wsl ${cmd}` }
  }

  // Trust manifest — exactly what the install script writes onto the user's
  // box. Kept hardcoded per agent so security-conscious enterprise users can
  // audit before running. Keep these in lockstep with the install scripts in
  // `cli/src/agents/` and `backend/app/setup/`.
  const installManifest = (id: AgentId): string[] =>
    id === 'claude-code'
      ? [
          '~/.claude/plugins/marketplaces/skillnote-local/ — plugin install root',
          '~/.claude/plugins/marketplaces/skillnote-local/marketplace.json',
          '~/.claude/plugins/skillnote/ — plugin file (skill loader + statusline hook)',
          '~/.claude/plugins/skillnote/statusline — statusline binary',
          'Shell-rc wrapper line appended to ~/.zshrc or ~/.bashrc',
          `Bridge daemon URL pinned to ${base}`,
        ]
      : [
          '~/.openclaw/skills/skillnote/ — skill install root',
          '~/.openclaw/skills/skillnote/sync.sh — refreshes skills on each session',
          '~/.openclaw/skills/skillnote/log-watcher.py — usage analytics agent',
          `~/.openclaw/skills/skillnote/config.json — host URL pinned to ${base}`,
          `Bridge daemon URL pinned to ${base}`,
        ]

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

  // Connected = agents in active or idle state. Everything else is browseable.
  const connected = AGENTS.filter((a) => {
    const s = effective[a.id].state
    return s === 'active' || s === 'idle'
  })
  const connectedCount = connected.length

  // First-load tab resolution. Only set the default once we've actually
  // heard back from /v1/setup/agents — otherwise we'd default to "Browse"
  // every time, even for returning users who already have connections.
  useEffect(() => {
    if (activeTab !== null) return
    if (!hydrated) return
    setActiveTab(connectedCount > 0 ? 'connected' : 'browse')
  }, [activeTab, hydrated, connectedCount])

  const renderRow = (agent: AgentMeta) => {
    const snap = effective[agent.id]
    // Only forward bridge logs to the row whose agent currently owns the job.
    // Other rows get `undefined` so we don't accidentally render claude-code
    // logs under openclaw (or vice versa).
    const logLines =
      pendingJob && pendingJob.agent === agent.id ? job?.log ?? [] : undefined
    return (
      <AgentListRow
        key={agent.id}
        state={snap.state}
        agentId={agent.id}
        agentLabel={agent.label}
        agentSublabel={agent.sublabel}
        agentMark={markFor(agent.id)}
        description={agent.description}
        platforms={agent.platforms}
        installCommand={installCmd(agent.id)}
        platformCommands={platformCmds(agent.id)}
        installManifest={installManifest(agent.id)}
        installedAt={snap.installedAt}
        lastCallAt={snap.lastCallAt}
        logLines={logLines}
        onConnectClick={() => handleConnect(agent.id)}
        onReinstall={() => handleReinstall(agent.id)}
        onDisconnect={() => handleDisconnect(agent.id)}
      />
    )
  }

  const renderCard = (agent: AgentMeta) => {
    const snap = effective[agent.id]
    return (
      <AgentCard
        key={agent.id}
        state={snap.state}
        agentLabel={agent.label}
        agentSublabel={agent.sublabel}
        agentMark={markFor(agent.id)}
        description={agent.description}
        badge={agent.badge ?? null}
        onConnectClick={() => handleConnect(agent.id)}
        // Card click jumps to the Connected tab so the user can manage
        // it after connecting — discovery → management handoff.
        onOpenDetail={() => setActiveTab('connected')}
      />
    )
  }

  return (
    <>
      <TopBar showFab={false} />
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <header className="mb-6">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">
              Integrations
            </h1>
          </header>

          <Tabs
            value={activeTab ?? 'browse'}
            onValueChange={(v) => setActiveTab(v as 'browse' | 'connected')}
          >
            <TabsList variant="line" className="mb-5 w-fit">
              <TabsTrigger
                value="browse"
                className="!flex-none px-3 text-[13px]"
              >
                Browse
                <span className="ml-1.5 text-[11px] text-muted-foreground/70 tabular-nums">
                  {AGENTS.length}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="connected"
                className="!flex-none px-3 text-[13px]"
              >
                Connected
                <span className="ml-1.5 text-[11px] text-muted-foreground/70 tabular-nums">
                  {connectedCount}
                </span>
              </TabsTrigger>
            </TabsList>

            {/* Browse — grid of portrait cards. Discovery surface, distinct
                from Connected's compact rows. VS Code marketplace pattern. */}
            <TabsContent value="browse">
              <ul
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3
                           [&>li]:list-none"
              >
                {AGENTS.map((a) => (
                  <li key={a.id}>{renderCard(a)}</li>
                ))}
              </ul>
            </TabsContent>

            {/* Connected — empty state if zero, otherwise just the wired ones */}
            <TabsContent value="connected">
              {connectedCount === 0 ? (
                <EmptyConnected onBrowse={() => setActiveTab('browse')} />
              ) : (
                <ul className="space-y-3">{connected.map(renderRow)}</ul>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <DevCycler overrides={overrides} setOverrides={setOverrides} />
    </>
  )
}

function labelOf(id: AgentId): string {
  return id === 'claude-code' ? 'Claude Code' : 'OpenClaw'
}

// ─── Empty state for the Connected tab ────────────────────────────────────

function EmptyConnected({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-card/20 px-6 py-12 text-center">
      <p className="text-[14px] font-medium text-foreground">
        Nothing connected
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground/80">
        Pick an agent from Browse to wire it in.
      </p>
      <button
        type="button"
        onClick={onBrowse}
        className="mt-5 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md
                   border border-border bg-background text-[13px] font-medium text-foreground
                   hover:bg-muted/50 transition-colors"
      >
        Browse
      </button>
    </div>
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
