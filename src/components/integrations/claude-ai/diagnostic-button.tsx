'use client'

/**
 * "Run diagnostic" button + results modal.
 *
 * One click runs the full check suite and renders pass/warn/fail per
 * check with remediation text. Single source of "is the connector
 * healthy?" for both end users and operators.
 *
 * Modal pattern (not a permanent panel) because the diagnostic isn't
 * something users look at every time — it's the escape hatch when
 * something feels off. Keeping it out of the default page chrome avoids
 * cognitive load.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Stethoscope,
  X,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { runDiagnostic, type DiagnosticResponse } from '@/lib/api/claude-ai'

export function DiagnosticButton() {
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DiagnosticResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      const r = await runDiagnostic()
      setResult(r)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }, [])

  const click = () => {
    setOpen(true)
    // Re-run on EVERY open so the verdict is always fresh. The previous code
    // skipped the re-run when the last result was 'pass', so reopening could
    // show a stale "All checks passed" even after the setup had since broken.
    if (!running) void run()
  }

  return (
    <>
      <button
        type="button"
        onClick={click}
        disabled={running}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[12px] text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        data-testid="diagnostic-button"
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Stethoscope className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        Run diagnostic
      </button>
      {open && (
        <DiagnosticModal
          result={result}
          error={error}
          running={running}
          onClose={() => setOpen(false)}
          onRerun={() => void run()}
        />
      )}
    </>
  )
}

function DiagnosticModal({
  result,
  error,
  running,
  onClose,
  onRerun,
}: {
  result: DiagnosticResponse | null
  error: string | null
  running: boolean
  onClose: () => void
  onRerun: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagnostic-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl"
        data-testid="diagnostic-modal"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h2
              id="diagnostic-modal-title"
              className="text-[14px] font-semibold text-foreground"
            >
              Connector diagnostic
            </h2>
            {result && (
              <OverallPill status={result.overall} />
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close diagnostic"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {error ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12.5px] text-red-700 dark:text-red-300">
              Couldn’t run diagnostic: {error}
            </div>
          ) : !result ? (
            <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Running checks…
            </div>
          ) : (
            <ul className="space-y-2" data-testid="diagnostic-results">
              {result.checks.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 bg-muted/20">
          {result && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              Generated{' '}
              <time dateTime={result.generated_at}>
                {new Date(result.generated_at).toLocaleTimeString()}
              </time>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onRerun}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              {running && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              )}
              Re-run
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90 transition-opacity"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function OverallPill({ status }: { status: 'pass' | 'warn' | 'fail' }) {
  const meta = {
    pass: {
      label: 'All checks passed',
      cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
      Icon: CheckCircle2,
    },
    warn: {
      label: 'Some warnings',
      cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
      Icon: AlertTriangle,
    },
    fail: {
      label: 'Action required',
      cls: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30',
      Icon: XCircle,
    },
  }[status]
  const { Icon } = meta
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
        meta.cls,
      )}
      data-testid={`diagnostic-overall-${status}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {meta.label}
    </span>
  )
}

function CheckRow({ check }: { check: { id: string; label: string; status: string; detail: string } }) {
  const tone = check.status === 'pass'
    ? 'text-emerald-600 dark:text-emerald-400'
    : check.status === 'warn'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-red-600 dark:text-red-400'
  const Icon = check.status === 'pass'
    ? CheckCircle2
    : check.status === 'warn'
      ? AlertTriangle
      : XCircle
  return (
    <li
      className="flex items-start gap-2 rounded-md border border-border bg-background p-2.5"
      data-testid={`diagnostic-check-${check.id}`}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0 mt-0.5', tone)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-foreground">{check.label}</p>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground leading-relaxed">
          {check.detail}
        </p>
      </div>
    </li>
  )
}
