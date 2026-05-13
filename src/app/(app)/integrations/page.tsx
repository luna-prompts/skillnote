'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, Plug2 } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AgentCard } from '@/components/integrations/agent-card'
import { AgentListRow } from '@/components/integrations/agent-list-row'
import { ConnectModal } from '@/components/integrations/connect-modal'
import { DisconnectModal } from '@/components/integrations/disconnect-modal'
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
  /** When this row entered `connecting` locally — used to detect a stale
   *  install that the backend can safely override (e.g. user closed the
   *  browser mid-install or the bridge daemon died). */
  connectingSince?: number
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
  /** Numbered steps shown in the post-success modal panel. */
  usageSteps: string[]
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
    usageSteps: [
      'Open a new terminal so the shell wrapper picks up.',
      'Run `claude` — the SkillNote collection picker appears.',
      'Pick a collection and start a session. Your skills load automatically.',
    ],
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    sublabel: 'Open-source agent runtime',
    description:
      'Self-hosted coding agent. The SkillNote skill syncs your registry continuously and reports back which skills the agent used.',
    platforms: ['macOS', 'Linux'],
    badge: 'official',
    usageSteps: [
      'Restart your OpenClaw session so the new skill loads.',
      'sync.sh runs every 60s — your registry stays current automatically.',
      'Try a task; the log-watcher reports which skills the agent used.',
    ],
  },
]

const ALL_STATES: ConnectionState[] = ['pending', 'connecting', 'active', 'idle']
const POLL_INTERVAL_MS = 5_000
// How long a local `connecting` state is trusted before the backend's view
// is allowed to override it. Without this, killing the browser mid-install
// or losing the bridge daemon strands the UI in `connecting` forever, because
// the polling loop refuses to overwrite a `connecting` row. 30s is long
// enough that a normal install (typically ~10s) won't be visually flipped to
// `active` before the modal's own success animation completes.
const CONNECTING_STALE_AFTER_MS = 30_000

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
  // Which agent (if any) is currently in the connect modal. Single-shot —
  // the modal owns its own dispatch + polling lifecycle internally.
  const [connectingAgent, setConnectingAgent] = useState<AgentId | null>(null)
  // Which agent is being disconnected (confirmation dialog open).
  const [disconnectingAgent, setDisconnectingAgent] = useState<AgentId | null>(null)

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
          const now = Date.now()
          for (const row of rows) {
            const local = prev[row.agent]
            // Don't overwrite an in-flight install — UNLESS the local
            // `connecting` is older than CONNECTING_STALE_AFTER_MS. Without
            // this escape hatch, killing the browser mid-install or losing
            // the bridge stranded the row in `connecting` forever.
            if (local?.state === 'connecting') {
              // Missing `connectingSince` (`?? 0`) is treated as "always stale"
              // by design — if a future code path sets `state: 'connecting'`
              // without stamping the timestamp, we'd rather have backend state
              // take over on the next poll than freeze the row forever.
              const since = local.connectingSince ?? 0
              if (now - since < CONNECTING_STALE_AFTER_MS) continue
            }
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
        [agent]: { ...prev[agent], state: 'connecting', connectingSince: Date.now() },
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
  // Each entry MUST follow `<label> — <value>` so the modal can parse it into
  // a two-column row. Keep labels short (2-4 words); values can be paths or
  // short descriptive strings.
  const installManifest = (id: AgentId): string[] =>
    id === 'claude-code'
      ? [
          'Plugin root — ~/.claude/plugins/marketplaces/skillnote-local/',
          'Marketplace manifest — ~/.claude/plugins/marketplaces/skillnote-local/marketplace.json',
          'Skill loader plugin — ~/.claude/plugins/skillnote/',
          'Statusline binary — ~/.claude/plugins/skillnote/statusline',
          'Shell wrapper — appended to ~/.zshrc or ~/.bashrc',
          `Bridge daemon — ${base}`,
        ]
      : [
          'Skill root — ~/.openclaw/skills/skillnote/',
          'Refresh hook — ~/.openclaw/skills/skillnote/sync.sh',
          'Analytics agent — ~/.openclaw/skills/skillnote/log-watcher.py',
          `Host config — ~/.openclaw/skills/skillnote/config.json`,
          `Bridge daemon — ${base}`,
        ]

  const handleReinstall = (id: AgentId) => {
    toast.info(`Re-running the install for ${labelOf(id)}…`)
    handleConnect(id)
  }

  // Disconnect requires confirmation — handleDisconnect just opens the
  // destructive-styled DisconnectConfirmModal. Actual DELETE happens in
  // confirmDisconnect below once the user has reviewed what gets removed.
  const handleDisconnect = useCallback((id: AgentId) => {
    setDisconnectingAgent(id)
  }, [])

  const confirmDisconnect = useCallback(
    async (id: AgentId) => {
      try {
        const res = await fetch(`${base}/v1/setup/installs/${id}`, { method: 'DELETE' })
        if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`)
        setSnapshots((prev) => ({
          ...prev,
          [id]: { id, state: 'pending', installedAt: undefined, lastCallAt: undefined },
        }))
        toast.success(`${labelOf(id)} disconnected`)
        // Stay on Connected tab — switching to Browse on every disconnect
        // disorients users who are working through multiple agents.
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error'
        toast.error(`Couldn't disconnect (${msg}). Try again or remove the plugin manually.`)
      } finally {
        setDisconnectingAgent(null)
      }
    },
    [base],
  )

  const markFor = (id: AgentId) =>
    id === 'claude-code' ? <ClaudeCodeMark /> : <OpenClawMark />

  // Connected = agents in active or idle state. Everything else is browseable.
  const connected = AGENTS.filter((a) => {
    const s = effective[a.id].state
    return s === 'active' || s === 'idle'
  })
  const connectedCount = connected.length

  // R9 (Connect-page round): Connected is the primary surface — agents you
  // already wired in are the thing you most often come back to. Default to
  // Connected always; the inner empty state for first-time users invites
  // them to Browse with a one-click button. Previously this branched on
  // `connectedCount > 0` so a fresh install defaulted to Browse — which made
  // the tab order feel like Browse-first. Now the tab order is
  // Connected | Browse and the default lands on Connected.
  useEffect(() => {
    if (activeTab !== null) return
    if (!hydrated) return
    setActiveTab('connected')
  }, [activeTab, hydrated])

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
        usageSteps={agent.usageSteps}
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
        platforms={agent.platforms}
        badge={agent.badge ?? null}
        // Install click opens the focused connect modal. Modal owns
        // dispatch + log polling. Resolves true immediately so the
        // card flips to "Connecting…" briefly while the modal mounts.
        onConnectClick={async () => {
          setConnectingAgent(agent.id)
          return true
        }}
        // Card click on already-connected agents jumps to Connected tab.
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
              Connect
            </h1>
          </header>

          <Tabs
            value={activeTab ?? 'connected'}
            onValueChange={(v) => setActiveTab(v as 'browse' | 'connected')}
          >
            <TabsList variant="line" className="mb-5 w-fit">
              {/* Connected first — it's the primary surface for returning
                  users and the activation-funnel target for new users. */}
              <TabsTrigger
                value="connected"
                className="!flex-none px-3 text-[13px]"
              >
                Connected
                <span className="ml-1.5 text-[11px] text-muted-foreground/70 tabular-nums">
                  {connectedCount}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="browse"
                className="!flex-none px-3 text-[13px]"
              >
                Browse
                <span className="ml-1.5 text-[11px] text-muted-foreground/70 tabular-nums">
                  {AGENTS.length}
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

      {/* Focused install dialog. Mounted at root so it overlays the page. */}
      {connectingAgent ? (() => {
        const meta = AGENTS.find((a) => a.id === connectingAgent)!
        return (
          <ConnectModal
            open={true}
            agentId={connectingAgent as JobAgent}
            agentLabel={meta.label}
            agentSubtitle={meta.description}
            agentMark={markFor(connectingAgent)}
            platformCommands={platformCmds(connectingAgent)}
            installManifest={installManifest(connectingAgent)}
            usageGuide={{
              steps: meta.usageSteps,
              links: [
                {
                  label: 'Documentation',
                  href: 'https://github.com/luna-prompts/skillnote#readme',
                },
              ],
            }}
            onClose={() => setConnectingAgent(null)}
            onViewConnected={() => setActiveTab('connected')}
            onSuccess={() => {
              // Optimistically mark the agent active so the Connected tab
              // is ready when the user clicks "View in Connected" or "Done".
              const id = connectingAgent
              setSnapshots((prev) => ({
                ...prev,
                [id]: { ...prev[id], state: 'active' as ConnectionState },
              }))
            }}
          />
        )
      })() : null}

      {disconnectingAgent ? (
        <DisconnectModal
          open={true}
          agentLabel={labelOf(disconnectingAgent)}
          agentMark={markFor(disconnectingAgent)}
          installManifest={installManifest(disconnectingAgent)}
          onClose={() => setDisconnectingAgent(null)}
          onConfirm={() => confirmDisconnect(disconnectingAgent)}
        />
      ) : null}

      <DevCycler overrides={overrides} setOverrides={setOverrides} />
    </>
  )
}

function labelOf(id: AgentId): string {
  return id === 'claude-code' ? 'Claude Code' : 'OpenClaw'
}

// ─── Empty state for the Connected tab ────────────────────────────────────

/**
 * R9 Connect-focused round: Connected is now the default tab even for fresh
 * installs, so the empty state has to do real onboarding work — explain what
 * "connecting an agent" buys the user AND give a one-click jump to Browse.
 * Previous copy was a single muted sentence + a small Browse button; now we
 * lead with the value prop and give the primary action visual weight.
 */
function EmptyConnected({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div
      className="rounded-xl border border-dashed border-border/70 bg-card/20
                 px-6 py-12 text-center"
    >
      <div
        className="mx-auto mb-4 flex h-10 w-10 items-center justify-center
                   rounded-full bg-muted/60 text-muted-foreground/80"
        aria-hidden="true"
      >
        <Plug2 className="h-5 w-5" />
      </div>
      <p className="text-[15px] font-semibold text-foreground tracking-tight">
        No agents connected yet
      </p>
      <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] text-muted-foreground/85 leading-relaxed">
        Wire in Claude Code or OpenClaw and SkillNote will sync your skills,
        stream usage analytics, and let you publish skills with one command.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onBrowse}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md
                     bg-foreground text-background text-[13px] font-medium
                     hover:opacity-90 transition-opacity
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Browse agents
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <a
          href="https://github.com/luna-prompts/skillnote#readme"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-md
                     text-[13px] text-muted-foreground hover:text-foreground
                     hover:bg-muted/50 transition-colors"
        >
          How it works
        </a>
      </div>
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
