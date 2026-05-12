import { ProductCard } from './product-card'
import { Connector, type ConnectionState } from './connector'
import { SkillNoteMark } from './agent-marks'

interface Props {
  state: ConnectionState
  agentLabel: string
  agentMark: React.ReactNode
}

/**
 * Two product cards wired by a connector. SkillNote is always on the left;
 * the agent on the right. The connector's appearance changes with state.
 *
 * No sublabels under the cards — the agent name on the right side is
 * already attributed in the row/card header above; the SkillNote
 * attribution is implicit (we're inside the SkillNote app).
 */
export function ConnectionDiagram({ state, agentLabel, agentMark }: Props) {
  return (
    <div className="flex items-start gap-2 w-full">
      <ProductCard label="SkillNote" mark={<SkillNoteMark />} />
      <div className="flex-1 pt-[34px]">
        <Connector state={state} />
      </div>
      <ProductCard label={agentLabel} mark={agentMark} />
    </div>
  )
}
