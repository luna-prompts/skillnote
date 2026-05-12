import { ProductCard } from './product-card'
import { Connector, type ConnectionState } from './connector'
import { SkillNoteMark } from './agent-marks'

interface Props {
  state: ConnectionState
  agentLabel: string
  agentSublabel?: string
  agentMark: React.ReactNode
}

/**
 * Two product cards wired by a connector. SkillNote is always on the left;
 * the agent on the right. The connector's appearance changes with state.
 */
export function ConnectionDiagram({ state, agentLabel, agentSublabel, agentMark }: Props) {
  return (
    <div className="flex items-start gap-2 w-full">
      <ProductCard label="SkillNote" sublabel="by Luna Prompts" mark={<SkillNoteMark />} />
      <div className="flex-1 pt-[34px]">
        <Connector state={state} />
      </div>
      <ProductCard label={agentLabel} sublabel={agentSublabel} mark={agentMark} />
    </div>
  )
}
