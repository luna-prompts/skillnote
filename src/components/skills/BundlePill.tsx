import { Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Skill } from '@/lib/mock-data'

type Size = 'sm' | 'md'
type PillSkill = Pick<Skill, 'origin' | 'source_path' | 'import_source_id' | 'forked_from_source'>

function isBundled(skill: PillSkill): boolean {
  return !!skill.origin || !!skill.import_source_id || !!skill.source_path
}

function isEdited(skill: PillSkill): boolean {
  return !!skill.forked_from_source || !!skill.origin?.forked
}

function deriveLabel(skill: PillSkill): string {
  const o = skill.origin
  if (o?.owner && o?.repo) return `${o.owner}/${o.repo}`
  if (skill.source_path) {
    const head = skill.source_path.split('@')[0]
    if (head) return head
  }
  if (o?.host) return o.host
  return 'Bundled'
}

function deriveTitle(skill: PillSkill): string {
  const base = skill.source_path || skill.origin?.url || deriveLabel(skill)
  return isEdited(skill) ? `${base} · edited locally` : `Bundled from ${base}`
}

export function BundlePill({
  skill,
  size = 'sm',
  className,
}: {
  skill: PillSkill
  size?: Size
  className?: string
}) {
  if (!isBundled(skill)) return null

  const label = deriveLabel(skill)
  const title = deriveTitle(skill)
  const edited = isEdited(skill)

  const sizing =
    size === 'md'
      ? 'h-[22px] px-2 text-[11px] gap-1.5'
      : 'h-[18px] px-1.5 text-[10px] gap-1'
  const iconSize = size === 'md' ? 'h-3 w-3' : 'h-2.5 w-2.5'

  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded font-medium max-w-[160px] shrink-0',
        sizing,
        edited
          ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'bg-muted/60 text-muted-foreground/70',
        className,
      )}
    >
      <Package className={cn(iconSize, 'shrink-0')} />
      <span className="truncate font-mono">{label}</span>
      {edited && <span className="ml-0.5 opacity-70">·edited</span>}
    </span>
  )
}
