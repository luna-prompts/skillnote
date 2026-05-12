import { cn } from '@/lib/utils'
import { ConnectionDiagram } from './connection-diagram'
import { ActionPanel } from './action-panel'
import type { ConnectionState } from './connector'

interface Props {
  state: ConnectionState
  agentLabel: string
  agentSublabel?: string
  agentMark: React.ReactNode
  installCommand: string
  installedAt?: string
  lastCallAt?: string
  onConnectClick?: () => Promise<boolean>
  onReinstall?: () => void
  onDisconnect?: () => void
}

/**
 * A single agent's connect card — header bar with mark + name + status pill
 * on the right, the wiring diagram below it, and a state-driven action panel
 * underneath. Both agents stack vertically on the page; no tabs.
 */
export function AgentRow(props: Props) {
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border/50">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="shrink-0 inline-flex items-center justify-center
                       [&>*]:!w-7 [&>*]:!h-7 [&_svg]:!w-4 [&_svg]:!h-4"
          >
            {props.agentMark}
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-foreground leading-tight tracking-tight truncate">
              {props.agentLabel}
            </p>
            {props.agentSublabel ? (
              <p className="text-[11.5px] text-muted-foreground leading-tight mt-0.5">
                {props.agentSublabel}
              </p>
            ) : null}
          </div>
        </div>
        <StatePill state={props.state} />
      </div>

      {/* Body — diagram + action panel */}
      <div className="px-5 pt-7 pb-5 space-y-5">
        <ConnectionDiagram
          state={props.state}
          agentLabel={props.agentLabel}
          agentSublabel={props.agentSublabel}
          agentMark={props.agentMark}
        />
        <ActionPanel
          state={props.state}
          agentLabel={props.agentLabel}
          installCommand={props.installCommand}
          installedAt={props.installedAt}
          lastCallAt={props.lastCallAt}
          onConnectClick={props.onConnectClick}
          onReinstall={props.onReinstall}
          onDisconnect={props.onDisconnect}
        />
      </div>
    </section>
  )
}

function StatePill({ state }: { state: ConnectionState }) {
  const meta =
    state === 'active'
      ? {
          label: 'Connected',
          dot: 'bg-emerald-500',
          wrap: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
        }
      : state === 'idle'
        ? {
            label: 'Idle',
            dot: 'bg-emerald-500/50',
            wrap: 'text-muted-foreground bg-muted/60 border-border',
          }
        : state === 'installed'
          ? {
              label: 'Waiting',
              dot: 'bg-amber-500',
              wrap: 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
            }
          : state === 'connecting'
            ? {
                label: 'Connecting',
                dot: 'bg-emerald-500 motion-safe:animate-pulse',
                wrap: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
              }
            : {
                label: 'Not connected',
                dot: 'bg-muted-foreground/40',
                wrap: 'text-muted-foreground bg-muted/60 border-border',
              }

  return (
    <span
      className={cn(
        'shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full',
        'text-[11px] font-medium border',
        meta.wrap,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  )
}
