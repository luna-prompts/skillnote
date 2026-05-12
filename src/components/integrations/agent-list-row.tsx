'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConnectionDiagram } from './connection-diagram'
import { ActionPanel, type PlatformCommands } from './action-panel'
import type { ConnectionState } from './connector'

interface Props {
  state: ConnectionState
  agentId: 'claude-code' | 'openclaw'
  agentLabel: string
  agentSublabel?: string
  agentMark: React.ReactNode
  /** One-line description for catalog/discovery rows. */
  description?: string
  /** OS platforms this agent supports (rendered as a thin chip strip). */
  platforms?: string[]
  installCommand: string
  /** Per-platform install commands rendered in the Advanced drawer's tabs. */
  platformCommands: PlatformCommands
  /** Per-agent file/path manifest shown under "What gets installed". */
  installManifest: string[]
  installedAt?: string
  lastCallAt?: string
  /**
   * Bridge log lines for the in-flight connect job (passed through to the
   * ActionPanel's ConnectingPanel). Only the agent being connected receives
   * a non-undefined value; everyone else stays `undefined`.
   */
  logLines?: readonly string[]
  /** Open by default (e.g. when only one agent and it's not connected). */
  defaultOpen?: boolean
  onConnectClick?: () => Promise<boolean>
  onReinstall?: () => void
  onDisconnect?: () => void
}

/**
 * One row of the Linear/Claude-style integration list. Collapsed by default
 * — clicking anywhere on the summary row expands the detail panel below it
 * (wire diagram + actions). Multiple rows can be open simultaneously; the
 * parent decides whether to enforce single-open.
 */
export function AgentListRow(props: Props) {
  const [open, setOpen] = useState(props.defaultOpen ?? false)
  const isConnected = props.state === 'active' || props.state === 'idle'

  return (
    <li
      className={cn(
        'rounded-xl border border-border bg-card overflow-hidden',
        'transition-shadow duration-200',
        open && 'shadow-[0_4px_18px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_18px_rgba(0,0,0,0.35)]',
      )}
    >
      {/* Summary row — always visible, clickable */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center justify-between gap-3 px-4 py-3',
          'hover:bg-muted/30 transition-colors text-left',
          open && 'bg-muted/20',
        )}
        aria-expanded={open}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span
            className="shrink-0 inline-flex items-center justify-center
                       [&>*]:!w-8 [&>*]:!h-8 [&_svg]:!w-4 [&_svg]:!h-4"
          >
            {props.agentMark}
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-foreground leading-tight tracking-tight truncate">
              {props.agentLabel}
            </p>
            {props.agentSublabel ? (
              <p className="text-[12px] text-muted-foreground leading-tight mt-0.5 truncate">
                {props.agentSublabel}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <StatusBadge state={props.state} lastCallAt={props.lastCallAt} />
          <ChevronRight
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform duration-200',
              open && 'rotate-90',
            )}
          />
        </div>
      </button>

      {/* Expandable detail panel — wire diagram + action panel */}
      {open && (
        <div
          className={cn(
            'px-5 pt-5 pb-5 space-y-5 border-t border-border/40 bg-background',
            'motion-safe:animate-[row-expand-in_280ms_ease-out]',
          )}
        >
          {(props.description || (props.platforms && props.platforms.length > 0)) && (
            <div className="space-y-2 -mt-1">
              {props.description ? (
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  {props.description}
                </p>
              ) : null}
              {props.platforms && props.platforms.length > 0 ? (
                <p className="text-[11px] text-muted-foreground/70 font-medium tracking-wide">
                  {props.platforms.join(' · ')}
                </p>
              ) : null}
            </div>
          )}

          {/* Wire diagram only appears once we're actually mid-connect or
              already connected. In pending state we hide it — the
              SkillNote↔Agent visual is the *reward* for clicking Connect,
              not a static preview. */}
          {props.state !== 'pending' && (
            <div className="motion-safe:animate-[wire-reveal_420ms_ease-out]">
              <ConnectionDiagram
                state={props.state}
                agentLabel={props.agentLabel}
                agentSublabel={props.agentSublabel}
                agentMark={props.agentMark}
              />
            </div>
          )}

          <ActionPanel
            state={props.state}
            agentId={props.agentId}
            agentLabel={props.agentLabel}
            installCommand={props.installCommand}
            platformCommands={props.platformCommands}
            installManifest={props.installManifest}
            installedAt={props.installedAt}
            lastCallAt={props.lastCallAt}
            logLines={props.logLines}
            onConnectClick={props.onConnectClick}
            onReinstall={props.onReinstall}
            onDisconnect={props.onDisconnect}
          />
        </div>
      )}
    </li>
  )
}

/**
 * Compact status badge used in the row summary. Different from the bigger
 * StatePill on the (now-deprecated) AgentRow — this one is smaller and
 * surfaces "last call" inline when relevant.
 */
function StatusBadge({
  state,
  lastCallAt,
}: {
  state: ConnectionState
  lastCallAt?: string
}) {
  // Single signal per state — color carries the meaning, no redundant dot
  // next to the word. Exception: 'connecting' keeps the pulsing dot because
  // animation is the signal that something is in flight.
  switch (state) {
    case 'active':
      return (
        <span className="text-[12px] text-emerald-700 dark:text-emerald-400 font-medium tabular-nums">
          Connected
          {lastCallAt ? (
            <span className="text-muted-foreground font-normal"> · {relativeTime(lastCallAt)}</span>
          ) : null}
        </span>
      )
    case 'idle':
      return (
        <span className="text-[12px] text-muted-foreground tabular-nums">
          Idle{lastCallAt ? <> · {relativeTime(lastCallAt)}</> : null}
        </span>
      )
    case 'connecting':
      return (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-400 font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
          Connecting
        </span>
      )
    case 'pending':
    default:
      return (
        <span className="text-[12px] text-muted-foreground">Available</span>
      )
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}
