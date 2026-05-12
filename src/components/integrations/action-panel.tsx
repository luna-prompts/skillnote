'use client'

import { ArrowRight, ChevronDown, Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ConnectionState } from './connector'

export interface AgentStats {
  lastCallAt: string // ISO
  calls7d: number
  uniqueSkills7d: number
  timeline7d: number[] // 7 bars, height 0..1
  topSkills: { slug: string; calls: number; lastAt: string }[]
}

interface Props {
  state: ConnectionState
  agentLabel: string
  /** The install command shown in the Advanced drawer for pending state. */
  installCommand: string
  /** Bridge job dispatcher for one-click connect. Returns true if accepted. */
  onConnectClick?: () => Promise<boolean>
  /** Optional install ping → if set, ISO time the agent's plugin first phoned home. */
  installedAt?: string
  /** Stats — only relevant for active / idle. */
  stats?: AgentStats
  /** For idle and active variants: callbacks. */
  onReinstall?: () => void
  onDisconnect?: () => void
}

/**
 * State-dispatched action panel that appears UNDER the connection diagram.
 *
 *   pending     → status line + big Connect button + Advanced drawer
 *   connecting  → status line + step indicator + Advanced drawer
 *   installed   → status line + "open your agent and try a task"
 *   active      → status line + stats dashboard + dim reinstall/disconnect
 *   idle        → muted variant of active
 */
export function ActionPanel(props: Props) {
  switch (props.state) {
    case 'pending':
      return <PendingPanel {...props} />
    case 'connecting':
      return <ConnectingPanel {...props} />
    case 'installed':
      return <InstalledPanel {...props} />
    case 'active':
    case 'idle':
      return <ActivePanel {...props} />
  }
}

// ─────────────────────────────────────────────────────────────────────────

function StatusLine({
  dotClass,
  children,
}: {
  dotClass: string
  children: React.ReactNode
}) {
  return (
    <p className="inline-flex items-center gap-2 text-[13px] text-foreground">
      <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
      {children}
    </p>
  )
}

function PendingPanel({
  agentLabel,
  installCommand,
  onConnectClick,
}: Props) {
  const [connecting, setConnecting] = useState(false)

  const handle = async () => {
    if (!onConnectClick) return
    setConnecting(true)
    const ok = await onConnectClick().catch(() => false)
    if (!ok) {
      toast.error('Could not start the install — try the manual command below.')
    }
    setConnecting(false)
  }

  return (
    <div className="text-center space-y-5">
      <StatusLine dotClass="bg-muted-foreground/40">Not connected</StatusLine>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={handle}
          disabled={connecting || !onConnectClick}
          className={cn(
            'inline-flex items-center gap-2 px-5 py-2.5 rounded-lg',
            'bg-foreground text-background text-[14px] font-medium',
            'shadow-sm hover:opacity-90 active:opacity-80',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-opacity duration-150',
          )}
        >
          {connecting ? 'Connecting…' : `Connect ${agentLabel}`}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[12px] text-muted-foreground">Takes ~30 seconds. We'll guide you.</p>
      <AdvancedDrawer installCommand={installCommand} />
    </div>
  )
}

function ConnectingPanel({ agentLabel, installCommand }: Props) {
  return (
    <div className="text-center space-y-4">
      <StatusLine dotClass="bg-emerald-500 motion-safe:animate-pulse">
        Connecting {agentLabel}…
      </StatusLine>
      <ol className="inline-flex flex-col gap-1.5 text-left text-[13px] text-muted-foreground">
        <StepItem state="done">Bridge ready</StepItem>
        <StepItem state="done">Install command sent</StepItem>
        <StepItem state="active">Detecting plugin on your machine…</StepItem>
        <StepItem state="pending">First skill call</StepItem>
      </ol>
      <AdvancedDrawer installCommand={installCommand} />
    </div>
  )
}

function StepItem({
  state,
  children,
}: {
  state: 'done' | 'active' | 'pending'
  children: React.ReactNode
}) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px]',
          state === 'done' && 'bg-emerald-500/15 text-emerald-600',
          state === 'active' && 'bg-amber-500/15 text-amber-600 motion-safe:animate-pulse',
          state === 'pending' && 'bg-muted text-muted-foreground/50',
        )}
      >
        {state === 'done' ? '✓' : state === 'active' ? '◐' : '○'}
      </span>
      <span
        className={cn(
          state === 'done' && 'text-foreground',
          state === 'active' && 'text-foreground font-medium',
          state === 'pending' && 'text-muted-foreground/60',
        )}
      >
        {children}
      </span>
    </li>
  )
}

function InstalledPanel({ agentLabel }: Props) {
  return (
    <div className="text-center space-y-3">
      <StatusLine dotClass="bg-amber-500">
        Installed — waiting for first task
      </StatusLine>
      <p className="text-[13px] text-muted-foreground max-w-md mx-auto">
        Open {agentLabel} and try any task. Skills activate automatically and we'll
        update this card the moment we see activity.
      </p>
    </div>
  )
}

function ActivePanel({
  state,
  stats,
  onReinstall,
  onDisconnect,
}: Props) {
  if (!stats) return null
  const isActive = state === 'active'

  return (
    <div className="space-y-5">
      <div className="text-center">
        <StatusLine dotClass={isActive ? 'bg-emerald-500' : 'bg-emerald-500/40'}>
          {isActive ? (
            <>Connected · last call {relativeTime(stats.lastCallAt)}</>
          ) : (
            <>Idle · last call {relativeTime(stats.lastCallAt)}</>
          )}
        </StatusLine>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 max-w-md mx-auto text-center">
        <Stat label="Calls / 7d" value={stats.calls7d.toString()} />
        <Stat label="Skills used" value={stats.uniqueSkills7d.toString()} />
        <Stat label="Avg / day" value={Math.round(stats.calls7d / 7).toString()} />
      </div>

      <Sparkline values={stats.timeline7d} active={isActive} />

      {/* Top skills */}
      <div className="max-w-md mx-auto">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Top skills
        </p>
        <ul className="divide-y divide-border/40 rounded-lg border border-border bg-card overflow-hidden">
          {stats.topSkills.slice(0, 3).map((s) => (
            <li key={s.slug} className="flex items-center justify-between px-3 py-2 text-[13px]">
              <span className="font-mono text-foreground truncate">{s.slug}</span>
              <span className="text-muted-foreground tabular-nums shrink-0 ml-3">
                {s.calls} · {relativeTime(s.lastAt)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Tiny destructive actions */}
      <div className="flex items-center justify-center gap-4 text-[12px] text-muted-foreground">
        <button
          type="button"
          onClick={onReinstall}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Reinstall
        </button>
        <span className="text-border">·</span>
        <button
          type="button"
          onClick={onDisconnect}
          className="hover:text-foreground transition-colors"
        >
          Disconnect
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[22px] font-semibold tabular-nums text-foreground tracking-tight">
        {value}
      </p>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">
        {label}
      </p>
    </div>
  )
}

function Sparkline({ values, active }: { values: number[]; active: boolean }) {
  const max = Math.max(...values, 1)
  return (
    <div className="flex items-end justify-center gap-1 h-12 max-w-md mx-auto">
      {values.map((v, i) => (
        <span
          key={i}
          className={cn(
            'w-3 rounded-sm transition-colors',
            active ? 'bg-emerald-500/70' : 'bg-emerald-500/30',
          )}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────

function AdvancedDrawer({ installCommand }: { installCommand: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(installCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="max-w-xl mx-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
        />
        Advanced install
      </button>
      {open && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-left space-y-2">
          <p className="text-[12px] text-muted-foreground">
            Run this in any terminal — or paste it to your AI agent and ask it to run.
          </p>
          <div className="flex items-center gap-2 rounded-md bg-background border border-border px-3 py-2 font-mono text-[12px]">
            <span className="text-muted-foreground select-none">$</span>
            <code className="flex-1 truncate">{installCommand}</code>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <Copy className="h-3 w-3" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <a
            href="https://github.com/luna-prompts/skillnote#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            View docs
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const sec = Math.max(0, Math.floor((now - then) / 1000))
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}
