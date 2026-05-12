'use client'

import { ArrowRight, Check, ChevronDown, Copy, ExternalLink, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getApiBaseUrl } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import type { ConnectionState } from './connector'

export type PlatformId = 'macos' | 'linux' | 'windows'
export type PlatformCommands = Record<PlatformId, string>

interface Props {
  state: ConnectionState
  agentId: 'claude-code' | 'openclaw'
  agentLabel: string
  installCommand: string
  /** Install command per platform; shown in the Advanced drawer's platform tabs. */
  platformCommands: PlatformCommands
  /** Plain-language list of what the install script puts on the user's machine. */
  installManifest: string[]
  installedAt?: string
  lastCallAt?: string
  /**
   * Live log lines streamed from the bridge job while state === 'connecting'.
   * Sourced from the parent's useJobPolling hook. Undefined for non-active
   * agent rows so we don't accidentally cross-wire logs between agents.
   */
  logLines?: readonly string[]
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

function PendingPanel(props: Props) {
  const { agentLabel, onConnectClick } = props
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
      <div className="flex justify-end">
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
      <AdvancedDrawer {...props} />
    </div>
  )
}

function ConnectingPanel(props: Props) {
  const { agentLabel, logLines } = props
  const lines = logLines ?? []
  // Auto-scroll the terminal to the latest line as new ones arrive. We pin to
  // the sentinel `<div>` after the last line rather than the line itself so
  // the scroll target is stable when lines are added or removed.
  const endRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [lines.length])

  return (
    <div className="space-y-3">
      <StatusLine dotClass="bg-emerald-500 motion-safe:animate-pulse">
        Connecting {agentLabel}…
      </StatusLine>
      <div
        data-testid="connecting-logs"
        className={cn(
          'rounded-lg border border-border bg-zinc-950 dark:bg-black',
          'px-3 py-2.5 font-mono text-[12px] leading-relaxed',
          'max-h-[200px] overflow-auto',
          'motion-safe:animate-[wire-reveal_280ms_ease-out]',
        )}
      >
        {lines.length === 0 ? (
          <p className="text-muted-foreground/70 italic motion-safe:animate-pulse">
            Waiting for bridge…
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {lines.map((line, i) => (
              <li
                key={`${i}-${line}`}
                className="flex gap-2 text-muted-foreground/80 break-all"
              >
                <span className="text-muted-foreground/40 select-none shrink-0">
                  ›
                </span>
                <span className="flex-1 whitespace-pre-wrap">{line}</span>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} aria-hidden="true" />
      </div>
      <AdvancedDrawer {...props} />
    </div>
  )
}

function ActivePanel({
  onReinstall,
  onDisconnect,
}: Props) {
  // No status line, no "last call" timestamp — the wire's green check
  // above says "connected", and detailed activity lives on the Analytics
  // page. Keep this panel down to just the two management actions.
  return (
    <div className="flex items-center justify-end gap-3 text-[12px] text-muted-foreground">
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
  )
}

// ─────────────────────────────────────────────────────────────────────────

const PLATFORM_LABEL: Record<PlatformId, string> = {
  macos: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
}

type TestResult =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok' }
  | { kind: 'pending' }
  | { kind: 'error'; message: string }

/**
 * Manual install panel. Surfaces platform-aware curl commands, an inline
 * connection probe, the file manifest the install script writes, and a docs
 * pointer at the foot. Intended for users who don't want to rely on the
 * bridge daemon (enterprise, air-gapped, or simply diagnosing a failure).
 */
function AdvancedDrawer({
  agentId,
  platformCommands,
  installManifest,
}: {
  agentId: 'claude-code' | 'openclaw'
  platformCommands: PlatformCommands
  installManifest: string[]
}) {
  const [open, setOpen] = useState(false)
  const [platform, setPlatform] = useState<PlatformId>('macos')
  const [copied, setCopied] = useState(false)
  const [manifestOpen, setManifestOpen] = useState(false)
  const [test, setTest] = useState<TestResult>({ kind: 'idle' })

  const copy = () => {
    navigator.clipboard.writeText(platformCommands[platform])
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const runTest = async () => {
    setTest({ kind: 'loading' })
    try {
      const res = await fetch(`${getApiBaseUrl()}/v1/setup/agents`, { cache: 'no-store' })
      if (!res.ok) {
        setTest({ kind: 'error', message: `Backend returned ${res.status}` })
        return
      }
      const rows = (await res.json()) as Array<{ agent: string; state: string }>
      const row = rows.find((r) => r.agent === agentId)
      if (row && row.state !== 'pending') {
        setTest({ kind: 'ok' })
      } else {
        setTest({ kind: 'pending' })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      setTest({ kind: 'error', message })
    }
  }

  return (
    <div data-testid="advanced-install-drawer">
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
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-4 space-y-4">
          {/* Platform tabs + command */}
          <div className="space-y-2.5">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground/80 font-semibold">
              Install command
            </p>
            <Tabs
              value={platform}
              onValueChange={(v) => {
                setPlatform(v as PlatformId)
                setCopied(false)
              }}
            >
              <TabsList variant="line" className="mb-2">
                {(['macos', 'linux', 'windows'] as PlatformId[]).map((p) => (
                  <TabsTrigger key={p} value={p} className="px-3 text-[12px]">
                    {PLATFORM_LABEL[p]}
                  </TabsTrigger>
                ))}
              </TabsList>

              {(['macos', 'linux', 'windows'] as PlatformId[]).map((p) => (
                <TabsContent key={p} value={p} className="space-y-2">
                  {p === 'windows' && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Windows requires WSL 2. The install script runs inside a
                      Linux shell — execute this from a WSL Ubuntu (or
                      equivalent) terminal. Native PowerShell is not yet
                      supported.
                    </p>
                  )}
                  <div className="flex items-center gap-2 rounded-md bg-background border border-border px-3 py-2 font-mono text-[12px]">
                    <span className="text-muted-foreground select-none">$</span>
                    <code className="flex-1 truncate">{platformCommands[p]}</code>
                    <button
                      type="button"
                      onClick={copy}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      <Copy className="h-3 w-3" />
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </div>

          {/* Test connection */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={runTest}
              disabled={test.kind === 'loading'}
              className="border border-border bg-background hover:bg-muted/40 text-[12px] px-3 py-1 rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {test.kind === 'loading' ? 'Testing…' : 'Test connection'}
            </button>
            <TestResultInline result={test} />
          </div>

          {/* What gets installed */}
          <div>
            <button
              type="button"
              onClick={() => setManifestOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown
                className={cn('h-3 w-3 transition-transform', manifestOpen && 'rotate-180')}
              />
              What gets installed
            </button>
            {manifestOpen && (
              <ul className="mt-2 rounded-md border border-border bg-background p-3 space-y-1.5 text-[12px] text-foreground">
                {installManifest.map((line) => (
                  <li key={line} className="flex items-start gap-2 leading-snug">
                    <span className="text-muted-foreground/70 select-none mt-[2px]">·</span>
                    <span className="font-mono text-[11.5px] break-all">{line}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer docs link */}
          <div className="pt-1">
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
        </div>
      )}
    </div>
  )
}

function TestResultInline({ result }: { result: TestResult }) {
  if (result.kind === 'idle' || result.kind === 'loading') return null
  if (result.kind === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
        <Check className="h-3 w-3" />
        Plugin detected
      </span>
    )
  }
  if (result.kind === 'pending') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <X className="h-3 w-3" />
        No install detected yet — make sure the command ran.
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
      <X className="h-3 w-3" />
      {result.message}
    </span>
  )
}

