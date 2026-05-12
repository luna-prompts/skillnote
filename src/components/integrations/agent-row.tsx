import { ConnectionDiagram } from './connection-diagram'
import { ActionPanel, type AgentStats } from './action-panel'
import type { ConnectionState } from './connector'

interface Props {
  state: ConnectionState
  agentLabel: string
  agentSublabel?: string
  agentMark: React.ReactNode
  installCommand: string
  installedAt?: string
  stats?: AgentStats
  onConnectClick?: () => Promise<boolean>
  onReinstall?: () => void
  onDisconnect?: () => void
}

/**
 * One agent's complete connection panel — diagram on top, action panel below.
 *
 * The visual ratio is intentional: the diagram dominates (it's the product
 * statement), the action panel is functional but secondary. The whole row
 * is centered in a 720px container so it reads as a "single thing" rather
 * than a wide bar.
 */
export function AgentRow(props: Props) {
  return (
    <section className="rounded-2xl border border-border bg-card/40 backdrop-blur-sm p-8 md:p-10">
      <div className="max-w-2xl mx-auto space-y-8">
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
          stats={props.stats}
          onConnectClick={props.onConnectClick}
          onReinstall={props.onReinstall}
          onDisconnect={props.onDisconnect}
        />
      </div>
    </section>
  )
}
