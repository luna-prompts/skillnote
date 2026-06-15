'use client'

import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ClaudeAIMark } from './agent-marks'

interface Props {
  /** Number of paired browsers (from listIntegrations). When > 0, the
   *  footer flips to a green "N connected" state matching AgentCard.   */
  connectedCount: number
}

/**
 * Visual sibling of `AgentCard` for claude.ai.
 *
 * claude.ai's install is a browser extension, not a `curl | bash` script,
 * so it can't share AgentCard's connect-modal flow. This card matches
 * AgentCard's anatomy (logo plate, identity, description, footer
 * button) but its action is a navigation to the dedicated setup page —
 * which owns the multi-step "install → paste URL → approve code" copy.
 */
export function ClaudeAICard({ connectedCount }: Props) {
  const isConnected = connectedCount > 0
  return (
    <Link
      href="/settings/integrations/claude-ai"
      className={cn(
        'group/card relative flex flex-col text-left min-h-[260px]',
        'rounded-xl border border-border/60 bg-card overflow-hidden',
        'bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_92%,var(--background))_0%,var(--card)_100%)]',
        'transition-[border-color,box-shadow,transform] duration-200',
        'hover:border-foreground/15 hover:shadow-[0_3px_18px_rgba(0,0,0,0.06)]',
        'dark:hover:shadow-[0_3px_18px_rgba(0,0,0,0.45)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
      )}
    >
      <div className="flex items-start justify-between px-5 pt-5 pb-3">
        <span
          className={cn(
            'shrink-0 inline-flex items-center justify-center',
            '[&>*]:!w-12 [&>*]:!h-12 [&_svg]:!w-6 [&_svg]:!h-6',
            'transition-transform duration-200 group-hover/card:scale-[1.04]',
          )}
        >
          <ClaudeAIMark />
        </span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide uppercase bg-foreground/5 text-foreground/70 border border-border">
          New
        </span>
      </div>

      <div className="px-5">
        <p className="text-[15px] font-semibold text-foreground tracking-tight leading-tight">
          claude.ai
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground/80 leading-tight">
          Anthropic web app
        </p>
      </div>

      <p
        className="mt-3 px-5 text-[12.5px] text-muted-foreground leading-relaxed
                   line-clamp-3"
      >
        Two-way sync between SkillNote and your claude.ai account. Install a
        browser extension once; skills flow both directions automatically.
      </p>

      <div className="flex-1 min-h-[16px]" />

      <div className="mx-3 h-px bg-border/60" />

      <div className="p-3">
        <div
          className={cn(
            'w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md',
            'text-[13px] font-medium transition-all duration-200',
            isConnected
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 group-hover/card:bg-emerald-500/15'
              : 'border border-border bg-background text-foreground group-hover/card:bg-foreground group-hover/card:text-background group-hover/card:border-foreground',
          )}
        >
          {isConnected ? (
            <>
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
              {connectedCount === 1
                ? '1 browser connected'
                : `${connectedCount} browsers connected`}
            </>
          ) : (
            <>
              Set up
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover/card:translate-x-0.5" />
            </>
          )}
        </div>
      </div>
    </Link>
  )
}

/**
 * Row variant for the "Connected" tab. Visually matches AgentListRow's
 * compact two-line layout. Renders only when at least one browser is paired.
 */
export function ClaudeAIConnectedRow({
  connectedCount,
}: {
  connectedCount: number
}) {
  if (connectedCount === 0) return null
  return (
    <Link
      href="/settings/integrations/claude-ai"
      className={cn(
        'group/row flex items-center gap-3 rounded-lg border border-border bg-card',
        'p-4 hover:border-foreground/15 hover:shadow-[0_2px_10px_rgba(0,0,0,0.04)] transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
      )}
      data-testid="claude-ai-connected-row"
    >
      <span className="shrink-0 inline-flex items-center justify-center [&>*]:!w-10 [&>*]:!h-10">
        <ClaudeAIMark />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-semibold text-foreground tracking-tight">
            claude.ai
          </p>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
            {connectedCount === 1 ? '1 browser' : `${connectedCount} browsers`}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Two-way skill sync via browser extension
        </p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover/row:text-foreground group-hover/row:translate-x-0.5 transition-all" />
    </Link>
  )
}
