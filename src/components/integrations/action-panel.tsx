'use client'

import { ArrowRight, ChevronDown, Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ConnectionState } from './connector'

interface Props {
  state: ConnectionState
  agentLabel: string
  installCommand: string
  installedAt?: string
  lastCallAt?: string
  onConnectClick?: () => Promise<boolean>
  onReinstall?: () => void
  onDisconnect?: () => void
}

/**
 * State-dispatched action panel rendered under the wiring diagram.
 *
 *   pending     → Connect button + Advanced drawer
 *   connecting  → step list + Advanced drawer
 *   installed   → "open your agent" copy
 *   active/idle → "last call N ago" + tiny Reinstall/Disconnect links
 *
 * Note: no analytics dashboard here. The Analytics page handles that.
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

function PendingPanel({ agentLabel, installCommand, onConnectClick }: Props) {
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          Takes ~30 seconds. We'll guide you.
        </p>
        <button
          type="button"
          onClick={handle}
          disabled={connecting || !onConnectClick}
          className={cn(
            'group inline-flex items-center gap-2 px-4 py-2 rounded-lg',
            'bg-foreground text-background text-[13px] font-medium',
            'shadow-[0_2px_8px_rgba(0,0,0,0.08)]',
            'hover:shadow-[0_4px_14px_rgba(0,0,0,0.12)] hover:opacity-95 active:opacity-85',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-sm',
            'transition-all duration-200',
          )}
        >
          {connecting ? 'Connecting…' : `Connect ${agentLabel}`}
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>
      </div>
      <AdvancedDrawer installCommand={installCommand} />
    </div>
  )
}

function ConnectingPanel({ agentLabel, installCommand }: Props) {
  return (
    <div className="space-y-4">
      <StatusLine dotClass="bg-emerald-500 motion-safe:animate-pulse">
        Connecting {agentLabel}…
      </StatusLine>
      <ol className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
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
    <div className="space-y-2">
      <StatusLine dotClass="bg-amber-500">
        Installed — waiting for first task
      </StatusLine>
      <p className="text-[13px] text-muted-foreground">
        Open {agentLabel} and try any task. Skills activate automatically;
        this card updates the moment we see activity.
      </p>
    </div>
  )
}

function ActivePanel({
  state,
  lastCallAt,
  onReinstall,
  onDisconnect,
}: Props) {
  const isActive = state === 'active'
  return (
    <div className="flex items-center justify-between gap-3">
      <StatusLine dotClass={isActive ? 'bg-emerald-500' : 'bg-emerald-500/50'}>
        {isActive ? 'Connected' : 'Idle'}
        {lastCallAt ? <> · last call {relativeTime(lastCallAt)}</> : null}
      </StatusLine>
      <div className="flex items-center gap-3 text-[12px] text-muted-foreground shrink-0">
        <button
          type="button"
          onClick={onReinstall}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Reinstall
        </button>
        <span className="text-border/80">·</span>
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
    <div>
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
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
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
