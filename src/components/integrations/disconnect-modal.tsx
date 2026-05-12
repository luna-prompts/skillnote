'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, ChevronRight, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  agentLabel: string
  agentMark: React.ReactNode
  installManifest: string[]
  onClose: () => void
  onConfirm: () => void | Promise<void>
}

/**
 * Compact disconnect confirmation. Built to feel like the install modal's
 * smaller twin — same agent mark, same header pattern — just narrower
 * (max-w-lg) and with a destructive red primary button instead of black.
 * The intent is "tap-to-confirm" for accidental clicks, not a scary alert.
 */
export function DisconnectModal({
  open,
  agentLabel,
  agentMark,
  installManifest,
  onClose,
  onConfirm,
}: Props) {
  const [showManifest, setShowManifest] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [open, submitting, onClose])

  if (!open) return null

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

  const handleConfirm = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onConfirm()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={`Disconnect ${agentLabel}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4
                 motion-safe:animate-[modal-in_180ms_ease-out]"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => !submitting && onClose()}
      />

      <div
        className={cn(
          'relative w-full max-w-lg rounded-2xl border border-border bg-card overflow-hidden',
          'shadow-[0_24px_60px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.04)]',
          'dark:shadow-[0_24px_60px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)]',
          'motion-safe:animate-[modal-pop_220ms_cubic-bezier(0.34,1.56,0.64,1)]',
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
          <div className="flex items-start gap-3 min-w-0">
            {/* Same wrapper the install modal uses — sizes the actual agent
                logo (not a colored placeholder) consistently. */}
            <span
              className="shrink-0 inline-flex items-center justify-center mt-0.5
                         [&>*]:!w-10 [&>*]:!h-10 [&_svg]:!w-[20px] [&_svg]:!h-[20px]"
            >
              {agentMark}
            </span>
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold text-foreground tracking-tight leading-tight">
                Disconnect {agentLabel}?
              </h2>
              <p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">
                SkillNote will stop syncing skills to {agentLabel}.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md
                       text-muted-foreground transition-colors
                       hover:bg-muted hover:text-foreground
                       disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 pb-5 space-y-3">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md
                       bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500
                       text-white text-[13px] font-medium
                       transition-colors disabled:opacity-70 disabled:cursor-wait
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Disconnecting…
              </>
            ) : (
              <>
                Disconnect {agentLabel}
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>

          <div className="pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={() => setShowManifest((v) => !v)}
              aria-expanded={showManifest}
              className="flex items-center gap-2 -mx-1 px-1 py-1.5
                         text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight
                className={cn(
                  'h-3 w-3 transition-transform duration-200',
                  showManifest && 'rotate-90',
                )}
              />
              <span>What gets disconnected</span>
              <span className="text-muted-foreground/70">{rows.length} items</span>
            </button>

            {showManifest && (
              <dl
                className="mt-1 divide-y divide-border/30 rounded-md bg-muted/15 motion-safe:animate-[row-expand-in_220ms_ease-out]"
              >
                {rows.map((row, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[140px_1fr] items-baseline gap-x-3 px-3 py-2"
                  >
                    <dt className="text-[11.5px] font-medium text-foreground/75 leading-snug">
                      {row.label}
                    </dt>
                    {row.value ? (
                      <dd
                        className={cn(
                          'text-[11.5px] text-muted-foreground leading-snug',
                          isPathLike(row.value)
                            ? 'font-mono text-[11px] break-all'
                            : 'font-normal',
                        )}
                      >
                        {row.value}
                      </dd>
                    ) : (
                      <dd className="text-[11.5px] text-muted-foreground/60 italic">—</dd>
                    )}
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
