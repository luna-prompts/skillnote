import { cn } from '@/lib/utils'

interface Props {
  label: string
  sublabel?: string
  mark: React.ReactNode
  className?: string
}

/**
 * One end of the wiring diagram — a square card holding a brand mark with
 * the product name underneath. Identical treatment for both SkillNote and
 * the agent so the eye reads them as paired devices being wired together.
 */
export function ProductCard({ label, sublabel, mark, className }: Props) {
  return (
    <div className={cn('flex flex-col items-center shrink-0', className)}>
      <div
        className={cn(
          'flex h-[88px] w-[88px] items-center justify-center',
          'rounded-2xl border border-border bg-card',
          'shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)]',
          'dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_4px_12px_rgba(0,0,0,0.25)]',
        )}
      >
        {mark}
      </div>
      <p className="mt-3 text-[13px] font-semibold text-foreground tracking-tight">
        {label}
      </p>
      {sublabel ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{sublabel}</p>
      ) : null}
    </div>
  )
}
