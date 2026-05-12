'use client'

import { useState } from 'react'
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
  onConnectClick?: () => Promise<boolean>
  onOpenDetail?: () => void
}

/**
 * Portrait card used in the Browse tab — the discovery surface. Anatomy:
 *
 *   ┌────────────────────────────┐
 *   │ [LOGO]        [Official]   │   ← logo top-left, optional badge top-right
 *   │                            │
 *   │ Claude Code                │   ← name (semibold)
 *   │ Anthropic CLI              │   ← sublabel (muted)
 *   │                            │
 *   │ Anthropic's official CLI…  │   ← description (line-clamp-3)
 *   │                            │
 *   │ ┌────────────────────────┐ │
 *   │ │     Install        →   │ │   ← full-width primary action
 *   │ └────────────────────────┘ │
 *   └────────────────────────────┘
 *
 * Compare with AgentListRow: that one's a horizontal management row used
 * in the Connected tab. The two surfaces deliberately diverge — discovery
 * vs management have different goals.
 */
export function AgentCard(props: Props) {
  const [connecting, setConnecting] = useState(false)
  const isConnected = props.state === 'active' || props.state === 'idle'

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
      toast.error('Could not start the install — open Connected → Advanced to run the command manually.')
    }
    setConnecting(false)
  }

  return (
    <button
      type="button"
      onClick={() => props.onOpenDetail?.()}
      className={cn(
        'group/card flex flex-col text-left',
        'rounded-xl border border-border/60 bg-card overflow-hidden',
        'transition-all duration-200',
        'hover:border-border hover:shadow-[0_2px_12px_rgba(0,0,0,0.05)]',
        'dark:hover:shadow-[0_2px_12px_rgba(0,0,0,0.35)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
      )}
    >
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
        <p
          className="mt-3 px-5 text-[12.5px] text-muted-foreground leading-relaxed
                     line-clamp-3"
        >
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
            if (e.key === 'Enter' || e.key === ' ') handle(e as unknown as React.MouseEvent)
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
