'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  X,
} from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { dispatchJob, useJobPolling, type JobAgent } from '@/lib/cli-jobs'
import { ConnectionDiagram } from './connection-diagram'

type ModalState =
  | { kind: 'starting' }
  | { kind: 'running'; jobId: string }
  | { kind: 'success' }
  | { kind: 'error'; reason: string }

type PlatformId = 'macos' | 'linux' | 'windows'

interface Props {
  open: boolean
  agentId: JobAgent
  agentLabel: string
  agentMark: React.ReactNode
  platformCommands: Record<PlatformId, string>
  onClose: () => void
  /** Called when the install completes successfully. Page typically uses
   *  this to refresh /v1/setup/agents and switch to Connected tab. */
  onSuccess?: () => void
}

const PLATFORM_LABEL: Record<PlatformId, string> = {
  macos: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
}

// Heuristic step list — paired with regex matchers against the bridge log
// stream. We bump the displayed step as soon as the matching log line is
// seen. Order matters; later steps win when both match.
const STEPS: { label: string; match: RegExp }[] = [
  { label: 'Bridge ready', match: /bridge|claim|ready/i },
  { label: 'Downloading plugin bundle', match: /download|fetch|curl/i },
  { label: 'Extracting files', match: /extract|unzip|extracting/i },
  { label: 'Registering plugin', match: /register|marketplace|install/i },
  { label: 'Verifying', match: /verify|verifi|✓|done/i },
]

/**
 * Focused install dialog — the proper Vercel/Slack-style integration
 * connect flow. Opens when the user clicks Install on an AgentCard.
 *
 * Owns the bridge-job lifecycle itself; the parent page only knows about
 * open/close and gets a `onSuccess` callback when the install completes.
 */
export function ConnectModal({
  open,
  agentId,
  agentLabel,
  agentMark,
  platformCommands,
  onClose,
  onSuccess,
}: Props) {
  const [state, setState] = useState<ModalState>({ kind: 'starting' })
  const { job } = useJobPolling(state.kind === 'running' ? state.jobId : null)

  // Fire dispatch when the modal opens. Reset state if open flips false→true.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState({ kind: 'starting' })
    ;(async () => {
      try {
        const { id } = await dispatchJob({ type: 'connect', agent: agentId })
        if (cancelled) return
        setState({ kind: 'running', jobId: id })
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'unknown error'
        setState({
          kind: 'error',
          reason: msg.includes('fetch')
            ? 'Bridge daemon not reachable. Use the manual command below.'
            : msg,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, agentId])

  // Watch job status changes — flip modal state to success/error.
  useEffect(() => {
    if (state.kind !== 'running' || !job) return
    if (job.status === 'succeeded') {
      setState({ kind: 'success' })
      // Notify parent so it can refresh and switch tabs after a brief
      // delay (let the user see the ✓ moment).
      const t = setTimeout(() => onSuccess?.(), 900)
      return () => clearTimeout(t)
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      setState({
        kind: 'error',
        reason:
          job.error ||
          (job.status === 'cancelled'
            ? 'Install cancelled.'
            : 'Install failed. Try the manual command below.'),
      })
    }
  }, [state, job, onSuccess])

  // ESC to close. Disabled while running to prevent accidental abort.
  useEffect(() => {
    if (!open) return
    const handle = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (state.kind === 'running' || state.kind === 'starting') return
      onClose()
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [open, state.kind, onClose])

  if (!open) return null

  // Strip ANSI escape codes (e.g. `\x1b[?25l`, color codes) so the log
  // terminal renders clean text instead of leaking shell control bytes.
  const logLines = (job?.log ?? []).map(stripAnsi).filter((l) => l.trim().length > 0)
  const currentStep = computeStep(logLines, state)
  const progress = computeProgress(state, currentStep)

  // Map modal state to the wire's ConnectionState so the diagram animates
  // alongside the install progress.
  const wireState =
    state.kind === 'success'
      ? 'active'
      : state.kind === 'error'
        ? 'pending'
        : 'connecting'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Install ${agentLabel}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4
                 motion-safe:animate-[modal-in_180ms_ease-out]"
    >
      {/* Backdrop — click outside disabled while running */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => {
          if (state.kind === 'running' || state.kind === 'starting') return
          onClose()
        }}
      />

      {/* Modal */}
      <div
        className={cn(
          'relative w-full max-w-lg rounded-2xl border border-border bg-card overflow-hidden',
          'shadow-[0_24px_60px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.04)]',
          'dark:shadow-[0_24px_60px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)]',
          'motion-safe:animate-[modal-pop_220ms_cubic-bezier(0.34,1.56,0.64,1)]',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="shrink-0 inline-flex items-center justify-center
                         [&>*]:!w-9 [&>*]:!h-9 [&_svg]:!w-[18px] [&_svg]:!h-[18px]"
            >
              {agentMark}
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-foreground tracking-tight">
                {state.kind === 'success'
                  ? `${agentLabel} connected`
                  : state.kind === 'error'
                    ? 'Install failed'
                    : `Connecting ${agentLabel}`}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {state.kind === 'success' && 'Plugin installed and verified.'}
                {state.kind === 'error' && 'Something didn’t complete.'}
                {state.kind === 'starting' && 'Sending install request…'}
                {state.kind === 'running' && currentStep}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={state.kind === 'running' || state.kind === 'starting'}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md
                       text-muted-foreground transition-colors
                       hover:bg-muted hover:text-foreground
                       disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Wire diagram — SkillNote ━━━ status ━━━ Agent, animated by state.
            This is the visual heart of the connect moment. */}
        <div className="px-5 pt-1 pb-5">
          <ConnectionDiagram
            state={wireState}
            agentLabel={agentLabel}
            agentMark={agentMark}
          />
        </div>

        {/* Progress bar */}
        <div className="px-5 pb-4">
          <Progress
            value={progress}
            className={cn(
              'h-1.5',
              state.kind === 'error' && '[&>div]:bg-red-500',
              state.kind === 'success' && '[&>div]:bg-emerald-500',
            )}
          />
        </div>

        {/* Log stream */}
        <div className="px-5">
          <LogStream lines={logLines} state={state} />
        </div>

        {/* Advanced install — collapsible, always available */}
        <div className="px-5 pt-4 pb-3">
          <AdvancedInstall platformCommands={platformCommands} />
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 px-5 pt-2 pb-4 border-t border-border/50 bg-muted/20">
          {state.kind === 'success' ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md
                         bg-foreground text-background text-[13px] font-medium
                         hover:opacity-90 transition-opacity"
            >
              Done
            </button>
          ) : state.kind === 'error' ? (
            <>
              <button
                type="button"
                onClick={() => setState({ kind: 'starting' })}
                className="px-3 py-1.5 rounded-md border border-border bg-background text-[13px] font-medium text-foreground hover:bg-muted/40 transition-colors"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              disabled
              className="px-3 py-1.5 rounded-md text-[13px] text-muted-foreground/50 cursor-not-allowed"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Bits ─────────────────────────────────────────────────────────────────

function LogStream({
  lines,
  state,
}: {
  lines: readonly string[]
  state: ModalState
}) {
  const endRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [lines.length])

  const empty = lines.length === 0
  return (
    <div
      data-testid="connect-modal-logs"
      className="rounded-md border border-border bg-zinc-950 dark:bg-black
                 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed
                 max-h-[200px] overflow-auto"
    >
      {empty ? (
        <p className="text-muted-foreground/60 italic">
          {state.kind === 'starting' ? 'Dispatching…' : 'Waiting for bridge…'}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {lines.map((line, i) => (
            <li
              key={`${i}-${line}`}
              className="flex gap-2 text-muted-foreground/80 break-all"
            >
              <span className="text-muted-foreground/40 select-none shrink-0">
                {state.kind === 'success' && i === lines.length - 1 ? '✓' : '›'}
              </span>
              <span className="flex-1 whitespace-pre-wrap">{line}</span>
            </li>
          ))}
        </ul>
      )}
      <div ref={endRef} aria-hidden="true" />
    </div>
  )
}

function AdvancedInstall({
  platformCommands,
}: {
  platformCommands: Record<PlatformId, string>
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<PlatformId>('macos')

  const copy = () => {
    navigator.clipboard.writeText(platformCommands[tab])
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
        Manual install
      </button>
      {open && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as PlatformId)}>
            <TabsList variant="line" className="w-fit">
              {(['macos', 'linux', 'windows'] as const).map((p) => (
                <TabsTrigger
                  key={p}
                  value={p}
                  className="!flex-none px-2.5 text-[12px]"
                >
                  {PLATFORM_LABEL[p]}
                </TabsTrigger>
              ))}
            </TabsList>
            {(['macos', 'linux', 'windows'] as const).map((p) => (
              <TabsContent key={p} value={p} className="mt-2">
                <div className="flex items-center gap-2 rounded-md bg-background border border-border px-3 py-2 font-mono text-[11.5px]">
                  <span className="text-muted-foreground select-none">$</span>
                  <code className="flex-1 truncate">{platformCommands[p]}</code>
                  <button
                    type="button"
                    onClick={copy}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <Copy className="h-3 w-3" />
                    {copied && tab === p ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </TabsContent>
            ))}
          </Tabs>
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

// ─── ANSI escape stripping ────────────────────────────────────────────────
// Bridge log lines come from a real shell session and contain control bytes
// like `\x1b[?25l` (hide cursor), `\x1b[31m` (red), `\x1b[K` (clear EOL).
// We want clean text in the terminal panel.
const ANSI_REGEX = /\x1b\[[0-9;?]*[a-zA-Z]/g
function stripAnsi(s: string): string {
  return s.replace(ANSI_REGEX, '').replace(/\r/g, '').trim()
}

// ─── State derivation ─────────────────────────────────────────────────────

function computeStep(logLines: readonly string[], state: ModalState): string {
  if (state.kind === 'starting') return 'Sending install request…'
  if (state.kind === 'success') return 'Installed.'
  if (state.kind === 'error') return state.reason
  // Walk the log lines from newest to oldest, return the first matching label
  for (let i = logLines.length - 1; i >= 0; i--) {
    for (let j = STEPS.length - 1; j >= 0; j--) {
      if (STEPS[j].match.test(logLines[i])) return STEPS[j].label + '…'
    }
  }
  return 'Waiting for bridge…'
}

function computeProgress(state: ModalState, currentStep: string): number {
  if (state.kind === 'success') return 100
  if (state.kind === 'error') return 100
  if (state.kind === 'starting') return 8
  // Find which step matches the currentStep label
  const idx = STEPS.findIndex((s) => currentStep.startsWith(s.label))
  if (idx < 0) return 15
  return Math.round(((idx + 1) / (STEPS.length + 1)) * 100)
}
