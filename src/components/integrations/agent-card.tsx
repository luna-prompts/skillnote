'use client'

import { useRef, useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ConnectionState } from './connector'

interface Props {
  state: ConnectionState
  agentLabel: string
  agentSublabel?: string
  agentMark: React.ReactNode
  description?: string
  /** Show a tiny "Official" / "New" / "Verified" badge in the top-right. */
  badge?: 'official' | 'new' | null
  /**
   * Brand-color accent line painted at the top of the card. CSS color string
   * (hex / rgb / etc). Optional — falls back to a neutral border line.
   */
  accentColor?: string
  onConnectClick?: () => Promise<boolean>
  onOpenDetail?: () => void
}

/**
 * Portrait card used in the Browse tab — the discovery surface.
 *
 * Visual layers (rich-but-minimal):
 *   1. 2px top accent line in the agent's brand color (Anthropic coral,
 *      OpenClaw red) — signals identity at a glance.
 *   2. Ambient radial spotlight that follows the cursor on hover. Pure CSS
 *      via `--x` / `--y` custom properties set on mousemove. No library.
 *   3. Soft fade from a faint card tint at the top to bg-card at the
 *      body — gives the surface depth without ornament.
 */
export function AgentCard(props: Props) {
  const [connecting, setConnecting] = useState(false)
  const isConnected = props.state === 'active' || props.state === 'idle'
  const cardRef = useRef<HTMLButtonElement | null>(null)

  // Cursor-tracked spotlight: store position as CSS vars and let a
  // radial-gradient overlay paint where the user's pointing. Updates are
  // setProperty calls — no React re-renders.
  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = cardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--spotlight-x', `${e.clientX - rect.left}px`)
    el.style.setProperty('--spotlight-y', `${e.clientY - rect.top}px`)
  }

  const handle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isConnected) {
      props.onOpenDetail?.()
      return
    }
    if (!props.onConnectClick) return
    setConnecting(true)
    const ok = await props.onConnectClick().catch(() => false)
    if (!ok) {
      toast.error(
        'Could not start the install — open Connected → Advanced to run the command manually.',
      )
    }
    setConnecting(false)
  }

  return (
    <button
      ref={cardRef}
      type="button"
      onMouseMove={handleMouseMove}
      onClick={() => props.onOpenDetail?.()}
      className={cn(
        'group/card relative flex flex-col text-left isolate',
        'rounded-xl border border-border/60 bg-card overflow-hidden',
        'transition-all duration-200',
        'hover:border-border hover:-translate-y-px',
        'hover:shadow-[0_4px_24px_rgba(0,0,0,0.06)]',
        'dark:hover:shadow-[0_4px_24px_rgba(0,0,0,0.4)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
      )}
      // Default spotlight position keeps it off-canvas so it's invisible
      // until hover sets the real coordinates.
      style={
        {
          '--spotlight-x': '-200px',
          '--spotlight-y': '-200px',
        } as React.CSSProperties
      }
    >
      {/* Brand accent line — sits at the very top edge */}
      {props.accentColor ? (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-[2px] z-10 opacity-70 group-hover/card:opacity-100 transition-opacity"
          style={{ backgroundColor: props.accentColor }}
        />
      ) : null}

      {/* Ambient top-fade — barely-there gradient so the card isn't flat */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-24 z-0
                   bg-gradient-to-b from-foreground/[0.03] to-transparent
                   dark:from-foreground/[0.04]"
      />

      {/* Cursor-tracked spotlight — only renders on hover via opacity */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-0
                   group-hover/card:opacity-100 transition-opacity duration-300"
        style={{
          background:
            'radial-gradient(220px circle at var(--spotlight-x) var(--spotlight-y), rgba(16,185,129,0.10), transparent 60%)',
        }}
      />

      {/* Content — relative so it sits above the ambient/spotlight layers */}
      <div className="relative z-10 flex flex-col flex-1">
        {/* Header — logo + badge */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3">
          <span
            className="shrink-0 inline-flex items-center justify-center
                       [&>*]:!w-12 [&>*]:!h-12 [&_svg]:!w-6 [&_svg]:!h-6"
          >
            {props.agentMark}
          </span>
          {props.badge ? <CardBadge kind={props.badge} /> : null}
        </div>

        {/* Identity */}
        <div className="px-5">
          <p className="text-[15px] font-semibold text-foreground tracking-tight leading-tight">
            {props.agentLabel}
          </p>
          {props.agentSublabel ? (
            <p className="mt-0.5 text-[12px] text-muted-foreground/80 leading-tight">
              {props.agentSublabel}
            </p>
          ) : null}
        </div>

        {/* Description — fixed line-clamp so all cards line up at the footer */}
        {props.description ? (
          <p className="mt-3 px-5 text-[12.5px] text-muted-foreground leading-relaxed line-clamp-3">
            {props.description}
          </p>
        ) : null}

        {/* Spacer pushes the footer to the bottom — cards align via flex */}
        <div className="flex-1" />

        {/* Footer — primary action */}
        <div className="p-3 pt-4">
          <div
            onClick={handle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ')
                handle(e as unknown as React.MouseEvent)
            }}
            role="button"
            tabIndex={0}
            className={cn(
              'w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md',
              'text-[13px] font-medium transition-all duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              isConnected
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15'
                : 'border border-border bg-background text-foreground hover:bg-foreground hover:text-background group-hover/card:border-foreground/30',
              connecting && 'opacity-70 cursor-wait',
            )}
          >
            {isConnected ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                Connected
              </>
            ) : connecting ? (
              'Connecting…'
            ) : (
              <>
                Install
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover/card:translate-x-0.5" />
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

function CardBadge({ kind }: { kind: 'official' | 'new' }) {
  const meta =
    kind === 'official'
      ? {
          label: 'Official',
          cls: 'bg-foreground/5 text-foreground/70 border border-border',
        }
      : {
          label: 'New',
          cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20',
        }
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide uppercase',
        meta.cls,
      )}
    >
      {meta.label}
    </span>
  )
}
