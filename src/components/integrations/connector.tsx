'use client'

import { Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ConnectionState =
  | 'pending'
  | 'connecting'
  | 'installed'
  | 'active'
  | 'idle'

interface Props {
  state: ConnectionState
  className?: string
}

/**
 * The wire between two products. State determines:
 *   - Line color (grey off / emerald on / amber waiting)
 *   - Line style (dashed when idle/pending, solid when live)
 *   - Packet dots traveling along the line (connecting / installed)
 *   - Center node content (empty ring / spinner / check)
 *
 * CSS keyframes only — no animation library. Honors prefers-reduced-motion
 * via `motion-safe:` prefix on the animated classes.
 */
export function Connector({ state, className }: Props) {
  const showPackets = state === 'connecting' || state === 'installed'
  const isLive = state === 'active' || state === 'idle'

  const lineColor =
    state === 'active'
      ? 'stroke-emerald-500'
      : state === 'idle'
        ? 'stroke-emerald-500/40'
        : state === 'installed'
          ? 'stroke-amber-500'
          : state === 'connecting'
            ? 'stroke-emerald-500/70'
            : 'stroke-muted-foreground/40'

  const packetColor =
    state === 'installed' ? 'bg-amber-500' : 'bg-emerald-500'

  const dashClass = isLive ? '' : '[stroke-dasharray:5_7]'

  return (
    <div className={cn('relative flex-1 min-w-[80px]', className)}>
      {/* The wire — pure SVG, stretches to container width */}
      <svg
        viewBox="0 0 400 64"
        preserveAspectRatio="none"
        className="block h-16 w-full"
        aria-hidden
      >
        <line
          x1="4"
          y1="32"
          x2="396"
          y2="32"
          className={cn('transition-colors duration-500', lineColor, dashClass)}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>

      {/* Packets — HTML divs absolutely positioned so percent-based animation
          tracks the responsive container width. Only mounted while the wire
          is actively carrying data. */}
      {showPackets && (
        <div className="pointer-events-none absolute inset-0">
          <Packet color={packetColor} delay="0s" />
          <Packet color={packetColor} delay="0.55s" />
          <Packet color={packetColor} delay="1.1s" />
        </div>
      )}

      {/* Center status node — floats above the line */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <CenterNode state={state} />
      </div>
    </div>
  )
}

function Packet({ color, delay }: { color: string; delay: string }) {
  return (
    <span
      className={cn(
        'absolute top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full',
        color,
        'motion-safe:animate-[packet-flow_1.8s_linear_infinite]',
      )}
      style={{ animationDelay: delay, left: '1%' }}
    />
  )
}

function CenterNode({ state }: { state: ConnectionState }) {
  const base = 'flex items-center justify-center rounded-full bg-background shadow-sm'
  const size = 'h-9 w-9'

  switch (state) {
    case 'active':
      return (
        <div
          className={cn(
            base,
            size,
            'border-2 border-emerald-500 text-emerald-500',
            'motion-safe:animate-[pulse-ring_3.4s_ease-in-out_infinite]',
          )}
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </div>
      )
    case 'idle':
      return (
        <div
          className={cn(base, size, 'border-2 border-emerald-500/40 text-emerald-500/60')}
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </div>
      )
    case 'installed':
      return (
        <div
          className={cn(base, size, 'border-2 border-amber-500 text-amber-500')}
        >
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
        </div>
      )
    case 'connecting':
      return (
        <div
          className={cn(base, size, 'border-2 border-emerald-500 text-emerald-500')}
        >
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
        </div>
      )
    case 'pending':
    default:
      return (
        <div className={cn(base, size, 'border-2 border-border/80')}>
          <span className="h-1.5 w-1.5 rounded-full bg-border" />
        </div>
      )
  }
}
