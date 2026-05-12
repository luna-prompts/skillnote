'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
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
  | { kind: 'confirm' }
  | { kind: 'starting' }
  | { kind: 'running'; jobId: string }
  | { kind: 'success' }
  | { kind: 'error'; reason: string }

type PlatformId = 'macos' | 'linux' | 'windows'

interface UsageGuide {
  /** Numbered steps the user follows after the install lands. */
  steps: string[]
  /** Optional link rows ({label, href}) shown under the steps. */
  links?: { label: string; href: string }[]
}

interface Props {
  open: boolean
  agentId: JobAgent
  agentLabel: string
  agentMark: React.ReactNode
  /** Short one-liner under the agent name in the confirm step. */
  agentSubtitle?: string
  platformCommands: Record<PlatformId, string>
  /** Plain-language list of what the install script writes onto the user's
   *  machine. Shown in the confirm step so the user can audit before
   *  approving. Pulled from the page's per-agent installManifest. */
  installManifest: string[]
  /** How-to-use guide rendered after a successful install. Per-agent. */
  usageGuide: UsageGuide
  onClose: () => void
  /** Called when the user clicks "View in Connected" after success. */
  onViewConnected?: () => void
  /** Called when the install completes successfully (after a brief delay). */
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
  agentSubtitle,
  platformCommands,
  installManifest,
  usageGuide,
  onClose,
  onViewConnected,
  onSuccess,
}: Props) {
  // Start in the 'confirm' step. User must click "Install" to dispatch.
  const [state, setState] = useState<ModalState>({ kind: 'confirm' })
  const { job } = useJobPolling(state.kind === 'running' ? state.jobId : null)

  // Reset to confirm step when the modal opens. (Re-opens of the same
  // agent should always show the confirm screen first, not jump back into
  // a stale running state.)
  useEffect(() => {
    if (!open) return
    setState({ kind: 'confirm' })
  }, [open, agentId])

  // Imperative "Install" action — moves confirm → starting → running.
  const startInstall = useCallback(async () => {
    setState({ kind: 'starting' })
    try {
      const { id } = await dispatchJob({ type: 'connect', agent: agentId })
      setState({ kind: 'running', jobId: id })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      setState({
        kind: 'error',
        reason: msg.includes('fetch')
          ? 'Bridge daemon not reachable. Use the manual command below.'
          : msg,
      })
    }
  }, [agentId])

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
  // alongside the install progress. Confirm step shows the calm pending
  // wire — animation only kicks in once the user actually clicks Install.
  const wireState =
    state.kind === 'success'
      ? 'active'
      : state.kind === 'error' || state.kind === 'confirm'
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
          'relative w-full max-w-2xl rounded-2xl border border-border bg-card overflow-hidden',
          'shadow-[0_24px_60px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.04)]',
          'dark:shadow-[0_24px_60px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)]',
          'motion-safe:animate-[modal-pop_220ms_cubic-bezier(0.34,1.56,0.64,1)]',
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <span
              className="shrink-0 inline-flex items-center justify-center mt-0.5
                         [&>*]:!w-10 [&>*]:!h-10 [&_svg]:!w-[20px] [&_svg]:!h-[20px]"
            >
              {agentMark}
            </span>
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold text-foreground tracking-tight leading-tight">
                {state.kind === 'confirm' && `Install ${agentLabel}`}
                {state.kind === 'starting' && `Connecting ${agentLabel}`}
                {state.kind === 'running' && `Connecting ${agentLabel}`}
                {state.kind === 'success' && `${agentLabel} connected`}
                {state.kind === 'error' && 'Install failed'}
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
                {state.kind === 'confirm' && (agentSubtitle || 'Review what gets installed, then confirm.')}
                {state.kind === 'starting' && 'Sending install request…'}
                {state.kind === 'running' && currentStep}
                {state.kind === 'success' && 'Ready to use.'}
                {state.kind === 'error' && 'Something didn’t complete.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={state.kind === 'running' || state.kind === 'starting'}
            aria-label="Close"
            className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md
                       text-muted-foreground transition-colors
                       hover:bg-muted hover:text-foreground
                       disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Wire diagram — hidden in confirm (it implies motion and reads as
            loading). Shown during running/success/error so the user can see
            the connection actually happen. */}
        {state.kind !== 'confirm' && (
          <div className="px-7 pt-1 pb-6">
            <ConnectionDiagram
              state={wireState}
              agentLabel={agentLabel}
              agentMark={agentMark}
            />
          </div>
        )}

        {/* Body — different content per step */}
        <div className={cn('px-7 pb-3', state.kind === 'confirm' && 'pt-2 pb-6')}>
          {state.kind === 'confirm' && (
            <ConfirmBody
              installManifest={installManifest}
              agentLabel={agentLabel}
              platformCommands={platformCommands}
              onInstall={startInstall}
            />
          )}

          {(state.kind === 'starting' || state.kind === 'running') && (
            <RunningPanel
              progress={progress}
              currentStep={currentStep}
              agentLabel={agentLabel}
            />
          )}

          {state.kind === 'error' && (
            <ErrorPanel reason={state.reason} logLines={logLines} />
          )}

          {state.kind === 'success' && (
            <SuccessGuide guide={usageGuide} agentLabel={agentLabel} />
          )}
        </div>

        {/* Manual install — for non-confirm flows; in confirm we render it
            inline inside the ConfirmBody so the Install button can sit right
            below the description without footer chrome competing for the eye. */}
        {state.kind !== 'confirm' && (
          <div className="px-7 pt-3 pb-3">
            <AdvancedInstall platformCommands={platformCommands} />
          </div>
        )}

        {/* Footer actions — hidden in confirm state (Install lives inline) */}
        <div
          className={cn(
            'flex items-center justify-end gap-2 px-7 pt-4 pb-5 border-t border-border/50 bg-muted/20',
            state.kind === 'confirm' && 'hidden',
          )}
        >
          {(state.kind === 'starting' || state.kind === 'running') && (
            <button
              type="button"
              disabled
              className="px-3 py-1.5 rounded-md text-[13px] text-muted-foreground/50 cursor-not-allowed"
            >
              Cancel
            </button>
          )}
          {state.kind === 'success' && (
            <>
              {onViewConnected ? (
                <button
                  type="button"
                  onClick={() => {
                    onViewConnected()
                    onClose()
                  }}
                  className="px-3 py-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  View in Connected
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md
                           bg-foreground text-background text-[13px] font-medium
                           hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </>
          )}
          {state.kind === 'error' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={startInstall}
                className="px-3 py-1.5 rounded-md border border-border bg-background text-[13px] font-medium text-foreground hover:bg-muted/40 transition-colors"
              >
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Confirm body ─────────────────────────────────────────────────────────

/**
 * Pre-install confirmation panel. Minimal by design.
 *
 * Layout:
 *   1. One-sentence description of what will happen.
 *   2. Primary [Install] button right below — no footer chrome, no Cancel
 *      (the X in the header is the dismiss path).
 *   3. Two subtle inline disclosure rows: "What gets installed" and
 *      "Manual install". Both collapsed by default, rendered as muted
 *      text triggers rather than bordered cards so they don't compete
 *      with the primary CTA.
 */
function ConfirmBody({
  installManifest,
  agentLabel,
  platformCommands,
  onInstall,
}: {
  installManifest: string[]
  agentLabel: string
  platformCommands: Record<PlatformId, string>
  onInstall: () => void
}) {
  const [showManifest, setShowManifest] = useState(false)

  const rows = installManifest.map((raw) => {
    const idx = raw.indexOf(' — ')
    if (idx === -1) return { label: raw, value: '' }
    return {
      label: raw.slice(0, idx).trim(),
      value: raw.slice(idx + 3).trim(),
    }
  })

  const isPathLike = (v: string) =>
    v.startsWith('~/') || v.startsWith('/') || v.startsWith('http')

  return (
    <div className="space-y-5">
      <p className="text-[13.5px] text-foreground/85 leading-relaxed">
        SkillNote will install a local plugin so {agentLabel} stays in sync
        with your registry. It runs entirely on this machine and can be
        undone anytime from the Connected tab.
      </p>

      <button
        type="button"
        onClick={onInstall}
        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md
                   bg-foreground text-background text-[13px] font-medium
                   hover:opacity-90 transition-opacity
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        Install
        <ArrowRight className="h-3.5 w-3.5" />
      </button>

      {/* Subtle disclosure rows — no cards, just muted inline triggers */}
      <div className="space-y-1 pt-2 border-t border-border/40">
        <button
          type="button"
          onClick={() => setShowManifest((v) => !v)}
          aria-expanded={showManifest}
          className="group flex items-center gap-2 -mx-1 px-1 py-2 text-left
                     text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 transition-transform duration-200',
              showManifest && 'rotate-90',
            )}
          />
          <span>What gets installed</span>
          <span className="text-muted-foreground/70">{rows.length} items</span>
        </button>

        {showManifest && (
          <dl
            className="divide-y divide-border/30 rounded-md bg-muted/15 motion-safe:animate-[row-expand-in_220ms_ease-out]"
          >
            {rows.map((row, i) => (
              <div
                key={i}
                className="grid grid-cols-[150px_1fr] items-baseline gap-x-4 px-3 py-2"
              >
                <dt className="text-[12px] font-medium text-foreground/75 leading-snug">
                  {row.label}
                </dt>
                {row.value ? (
                  <dd
                    className={cn(
                      'text-[12px] text-muted-foreground leading-snug',
                      isPathLike(row.value)
                        ? 'font-mono text-[11.5px] break-all'
                        : 'font-normal',
                    )}
                  >
                    {row.value}
                  </dd>
                ) : (
                  <dd className="text-[12px] text-muted-foreground/60 italic">
                    —
                  </dd>
                )}
              </div>
            ))}
          </dl>
        )}

        <InlineManualInstall platformCommands={platformCommands} />
      </div>
    </div>
  )
}

/**
 * Compact inline variant of AdvancedInstall — same platform-tab + copy-cmd
 * machinery, but rendered as a muted disclosure trigger (no card, no
 * "ADVANCED" badge) so it sits quietly under the primary CTA.
 */
function InlineManualInstall({
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
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 -mx-1 px-1 py-2 text-left
                   text-[12px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight
          className={cn(
            'h-3 w-3 transition-transform duration-200',
            open && 'rotate-90',
          )}
        />
        <span>Manual install</span>
        <span className="text-muted-foreground/70">run the command yourself</span>
      </button>
      {open && (
        <div className="rounded-md bg-muted/15 p-3 space-y-2 motion-safe:animate-[row-expand-in_220ms_ease-out]">
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
        </div>
      )}
    </>
  )
}

// ─── Success guide ────────────────────────────────────────────────────────

function SuccessGuide({
  guide,
  agentLabel,
}: {
  guide: UsageGuide
  agentLabel: string
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        How to use {agentLabel}
      </p>
      <ol className="space-y-2 text-[13px] text-foreground">
        {guide.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5 leading-snug">
            <span
              className="shrink-0 inline-flex h-5 w-5 items-center justify-center
                         rounded-full bg-foreground/5 text-[11px] font-medium text-foreground/70 tabular-nums"
            >
              {i + 1}
            </span>
            <span className="text-foreground/85">{step}</span>
          </li>
        ))}
      </ol>
      {guide.links && guide.links.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
          {guide.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ─── Running / error panels ───────────────────────────────────────────────

/**
 * Clean, calm progress display for the in-flight install. Replaces the
 * earlier terminal-dump log view — those raw bash lines were dev-noisy and
 * unhelpful for non-engineers.
 *
 * Layout (Vercel-style):
 *   - Thin progress bar with percentage label.
 *   - Spinner + current step text below. The text crossfades on change
 *     (React key trick) so the user sees real motion as steps tick over.
 */
function RunningPanel({
  progress,
  currentStep,
  agentLabel,
}: {
  progress: number
  currentStep: string
  agentLabel: string
}) {
  return (
    <div className="space-y-5 py-2">
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-[12px] text-muted-foreground">
            Setting up {agentLabel}
          </span>
          <span className="text-[12px] font-medium text-foreground/85 tabular-nums">
            {progress}%
          </span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>
      <div className="flex items-center gap-2.5 min-h-[20px]">
        <Loader2 className="h-3.5 w-3.5 text-muted-foreground/70 motion-safe:animate-spin shrink-0" />
        <span
          key={currentStep}
          className="text-[13px] text-foreground/80 motion-safe:animate-[step-fade-in_320ms_ease-out]"
        >
          {currentStep}
        </span>
      </div>
    </div>
  )
}

/**
 * Error display — clean card with title + plain-English explanation. The
 * raw bridge log is tucked under a collapsible so curious engineers can
 * still see what happened without forcing everyone through a wall of text.
 */
function ErrorPanel({
  reason,
  logLines,
}: {
  reason: string
  logLines: readonly string[]
}) {
  const [showDetails, setShowDetails] = useState(false)
  return (
    <div className="space-y-3 py-1">
      <div className="rounded-lg border border-red-200/70 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/20 px-4 py-3.5">
        <div className="flex items-start gap-3">
          <AlertCircle
            className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0"
            strokeWidth={2}
          />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-red-900 dark:text-red-200 leading-snug">
              Install didn’t complete
            </p>
            <p className="mt-1 text-[12.5px] text-red-800/85 dark:text-red-200/85 leading-relaxed">
              {reason}
            </p>
          </div>
        </div>
      </div>

      {logLines.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
            className="flex items-center gap-2 -mx-1 px-1 py-1 text-[12px]
                       text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight
              className={cn(
                'h-3 w-3 transition-transform duration-200',
                showDetails && 'rotate-90',
              )}
            />
            Show technical details
          </button>
          {showDetails && (
            <pre
              className="mt-2 rounded-md border border-border/60 bg-muted/30
                         p-3 font-mono text-[11px] text-muted-foreground/85
                         overflow-auto max-h-[200px] whitespace-pre-wrap break-all
                         motion-safe:animate-[row-expand-in_220ms_ease-out]"
            >
              {logLines.join('\n')}
            </pre>
          )}
        </div>
      )}
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
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3
                   text-left transition-colors hover:bg-muted/20
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
      >
        <div className="flex items-center gap-2.5">
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
              open && 'rotate-90 text-foreground/70',
            )}
          />
          <span className="text-[12.5px] font-medium text-foreground/85">
            Manual install
          </span>
          <span className="text-[11.5px] text-muted-foreground">
            Run the command yourself
          </span>
        </div>
        <span className="text-[10.5px] text-muted-foreground uppercase tracking-[0.12em]">
          Advanced
        </span>
      </button>
      {open && (
        <div className="border-t border-border/40 p-4 space-y-2 motion-safe:animate-[row-expand-in_220ms_ease-out]">
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
