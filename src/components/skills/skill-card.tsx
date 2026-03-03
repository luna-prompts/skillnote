import Link from 'next/link'
import { Skill } from '@/lib/mock-data'
import { MessageSquare, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'

const CARD_ACCENTS = [
  { bg: 'bg-violet-500/10 dark:bg-violet-500/15', text: 'text-violet-600 dark:text-violet-400', border: 'border-violet-500/15', dot: 'bg-violet-400' },
  { bg: 'bg-sky-500/10 dark:bg-sky-500/15', text: 'text-sky-600 dark:text-sky-400', border: 'border-sky-500/15', dot: 'bg-sky-400' },
  { bg: 'bg-teal-500/10 dark:bg-teal-500/15', text: 'text-teal-600 dark:text-teal-400', border: 'border-teal-500/15', dot: 'bg-teal-400' },
  { bg: 'bg-amber-500/10 dark:bg-amber-500/15', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/15', dot: 'bg-amber-400' },
  { bg: 'bg-rose-500/10 dark:bg-rose-500/15', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/15', dot: 'bg-rose-400' },
]

export function SkillCard({ skill }: { skill: Skill }) {
  const initials = skill.title.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const colorIdx = skill.title.charCodeAt(0) % CARD_ACCENTS.length
  const accent = CARD_ACCENTS[colorIdx]
  const commentCount = skill.comments?.length ?? 0
  const attachCount = skill.attachments?.length ?? 0

  return (
    <Link
      href={`/skills/${skill.slug}`}
      className="group block bg-card rounded-xl border border-border/40 hover:border-accent/25 hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] dark:hover:shadow-[0_8px_30px_rgba(0,0,0,0.35)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.995] transition-all duration-250 relative overflow-hidden"
    >
      {/* Subtle top gradient accent */}
      <div className={cn('absolute top-0 left-0 right-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-300', accent.dot)} />

      <div className="p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-bold tracking-wide border transition-all duration-200',
            accent.bg, accent.text, accent.border,
            'group-hover:scale-105'
          )}>
            {initials}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h3 className="text-[13px] font-semibold text-foreground group-hover:text-accent transition-colors duration-200 leading-tight truncate">
              {skill.title}
            </h3>
            {(commentCount > 0 || attachCount > 0) && (
              <div className="flex items-center gap-2 mt-1">
                {commentCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/30">
                    <MessageSquare className="h-2.5 w-2.5" />
                    {commentCount}
                  </span>
                )}
                {attachCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/30">
                    <Paperclip className="h-2.5 w-2.5" />
                    {attachCount}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <p className="text-[12px] text-muted-foreground/50 line-clamp-2 mb-4 leading-relaxed group-hover:text-muted-foreground/65 transition-colors duration-200">
          {skill.description}
        </p>
        <div className="flex items-center justify-between pt-3 border-t border-border/30">
          <div className="flex gap-1.5 flex-wrap items-center">
            {skill.current_version > 0 && (
              <span className="text-[10px] font-mono font-medium text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded-md">
                v{skill.current_version}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}
