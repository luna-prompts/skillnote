import Link from 'next/link'
import { FileText, MessageSquare, Paperclip } from 'lucide-react'
import { Skill } from '@/lib/mock-data'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

const TAG_ACCENT: Record<string, string> = {
  react: 'bg-sky-400',
  typescript: 'bg-blue-500',
  api: 'bg-emerald-400',
  testing: 'bg-amber-400',
  workflow: 'bg-violet-400',
  devops: 'bg-orange-400',
  nextjs: 'bg-foreground',
  productivity: 'bg-rose-400',
}

export function SkillListItem({ skill }: { skill: Skill }) {
  const accentColor = TAG_ACCENT[skill.tags[0]] ?? 'bg-muted-foreground/30'
  const commentCount = skill.comments?.length ?? 0
  const attachCount = skill.attachments?.length ?? 0

  return (
    <Link
      href={`/skills/${skill.slug}`}
      className="group flex items-stretch border-b border-border/30 hover:bg-accent/[0.03] dark:hover:bg-accent/[0.05] active:bg-muted/40 transition-all duration-150 cursor-pointer relative"
    >
      {/* Left accent stripe */}
      <div className={cn('w-[3px] shrink-0 rounded-full my-2.5 ml-3 opacity-25 group-hover:opacity-60 transition-opacity duration-200', accentColor)} />

      <div className="flex-1 flex items-center gap-3 px-3 sm:px-4 py-3.5 min-h-[56px] min-w-0">
        <FileText className="h-3.5 w-3.5 text-muted-foreground/25 group-hover:text-accent/50 shrink-0 transition-colors duration-200" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground group-hover:text-accent transition-colors duration-200 truncate">
              {skill.title}
            </span>
            {/* Inline metadata indicators */}
            {(commentCount > 0 || attachCount > 0) && (
              <div className="hidden sm:flex items-center gap-1.5 shrink-0">
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
          <span className="text-[12px] text-muted-foreground/35 leading-snug truncate hidden lg:block mt-0.5 group-hover:text-muted-foreground/55 transition-colors duration-200">
            {skill.description}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {skill.current_version > 0 && (
            <span className="text-[10px] font-mono font-medium text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded hidden sm:inline">
              v{skill.current_version}
            </span>
          )}
          {skill.tags.slice(0, 2).map((tag, i) => (
            <span
              key={tag}
              className={cn(
                'text-[10px] font-mono font-medium px-2 py-0.5 rounded-md border transition-colors duration-200',
                'text-muted-foreground/50 bg-foreground/[0.02] border-foreground/[0.05]',
                'group-hover:text-muted-foreground/70 group-hover:border-foreground/[0.08]',
                i > 0 && 'hidden sm:inline'
              )}
            >
              {tag}
            </span>
          ))}
          <span className="text-[11px] text-muted-foreground/25 w-14 text-right tabular-nums font-mono group-hover:text-muted-foreground/40 transition-colors duration-200">
            {formatRelative(skill.updated_at)}
          </span>
        </div>
      </div>
    </Link>
  )
}
