import Link from 'next/link'
import { FileText } from 'lucide-react'
import { Skill } from '@/lib/mock-data'
import { formatRelative } from '@/lib/format'

export function SkillListItem({ skill }: { skill: Skill }) {
  return (
    <Link
      href={`/skills/${skill.slug}`}
      className="group flex items-center gap-3 px-4 sm:px-5 py-3 min-h-[48px] hover:bg-accent/[0.04] dark:hover:bg-accent/[0.06] active:bg-muted/50 border-b border-border/40 transition-all cursor-pointer"
    >
      <FileText className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-accent/60 shrink-0 transition-colors" />
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <span className="text-[13px] font-semibold text-foreground group-hover:text-accent transition-colors truncate">
          {skill.title}
        </span>
        <span className="text-[12px] text-muted-foreground/40 truncate hidden lg:block flex-1 group-hover:text-muted-foreground/60 transition-colors">
          {skill.description}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {skill.tags.slice(0, 1).map(tag => (
          <span key={tag} className="text-[10px] font-mono font-medium text-muted-foreground/70 bg-muted/60 dark:bg-muted/40 px-1.5 py-0.5 rounded sm:inline">
            {tag}
          </span>
        ))}
        {skill.tags.slice(1, 2).map(tag => (
          <span key={tag} className="text-[10px] font-mono font-medium text-muted-foreground/70 bg-muted/60 dark:bg-muted/40 px-1.5 py-0.5 rounded hidden sm:inline">
            {tag}
          </span>
        ))}
        <span className="text-[11px] text-muted-foreground/40 w-14 text-right tabular-nums">
          {formatRelative(skill.updated_at)}
        </span>
      </div>
    </Link>
  )
}
