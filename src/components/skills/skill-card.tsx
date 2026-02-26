import Link from 'next/link'
import { Skill } from '@/lib/mock-data'
import { formatRelative } from '@/lib/format'

const TAG_COLORS = ['bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300', 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300', 'bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300', 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300', 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300']

export function SkillCard({ skill }: { skill: Skill }) {
  const initials = skill.title.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const colorIdx = skill.title.charCodeAt(0) % TAG_COLORS.length

  return (
    <Link
      href={`/skills/${skill.slug}`}
      className="group block bg-card rounded-xl border border-border/60 p-5 hover:border-accent/30 hover:shadow-[0_4px_24px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_4px_24px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.99] transition-all duration-200"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-[12px] font-bold ${TAG_COLORS[colorIdx]}`}>
          {initials}
        </div>
        <h3 className="text-[13px] font-semibold text-foreground group-hover:text-accent transition-colors leading-tight pt-1">
          {skill.title}
        </h3>
      </div>
      <p className="text-[12px] text-muted-foreground/70 line-clamp-2 mb-4 leading-relaxed">
        {skill.description}
      </p>
      <div className="flex items-center justify-between pt-3 border-t border-border/40">
        <div className="flex gap-1 flex-wrap items-center">
          {skill.current_version > 0 && (
            <span className="text-[10px] font-mono font-medium text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded-md">
              v{skill.current_version}
            </span>
          )}
          {skill.tags.slice(0, 2).map(tag => (
            <span key={tag} className="text-[11px] font-mono text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md">
              {tag}
            </span>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground/50 tabular-nums">{formatRelative(skill.updated_at)}</span>
      </div>
    </Link>
  )
}
