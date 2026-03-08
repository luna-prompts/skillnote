import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FileText, MessageSquare, Paperclip, FolderOpen, Star } from 'lucide-react'
import { Skill } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export function SkillListItem({ skill, rating }: { skill: Skill; rating?: { avg_rating: number | null; rating_count: number } }) {
  const router = useRouter()
  const commentCount = skill.comments?.length ?? 0
  const attachCount = skill.attachments?.length ?? 0
  const collections = skill.collections ?? []

  return (
    <Link
      href={`/skills/${skill.slug}`}
      className="group flex items-stretch border-b border-border/30 hover:bg-accent/[0.03] dark:hover:bg-accent/[0.05] active:bg-muted/40 transition-all duration-150 cursor-pointer relative"
    >
      {/* Left accent stripe */}
      <div className={cn('w-[3px] shrink-0 rounded-full my-2.5 ml-3 opacity-25 group-hover:opacity-60 transition-opacity duration-200', 'bg-muted-foreground/30')} />

      <div className="flex-1 flex items-center gap-3 px-3 sm:px-4 py-3.5 min-h-[56px] min-w-0">
        <FileText className="h-3.5 w-3.5 text-muted-foreground/25 group-hover:text-accent/50 shrink-0 transition-colors duration-200" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground group-hover:text-accent transition-colors duration-200 truncate">
              {skill.title}
            </span>
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
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[12px] text-muted-foreground/35 leading-snug truncate hidden lg:block group-hover:text-muted-foreground/55 transition-colors duration-200">
              {skill.description}
            </span>
            {/* Collection chips — use span+router.push to avoid <a> inside <a> */}
            {collections.length > 0 && (
              <div className="hidden sm:flex items-center gap-1 shrink-0">
                {collections.map(c => {
                  const colSlug = c.toLowerCase().replace(/\s+/g, '-')
                  return (
                    <span
                      key={c}
                      tabIndex={0}
                      onClick={e => { e.preventDefault(); e.stopPropagation(); router.push(`/collections/${colSlug}`) }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); router.push(`/collections/${colSlug}`) } }}
                      className="flex items-center gap-0.5 h-[18px] px-1.5 rounded text-[10px] text-muted-foreground/50 bg-muted/60 hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                    >
                      <FolderOpen className="h-2.5 w-2.5 shrink-0" />
                      {c}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {rating && rating.rating_count > 0 && rating.avg_rating != null && (
            <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 hidden sm:flex">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              {rating.avg_rating.toFixed(1)}
            </span>
          )}
          {skill.current_version > 0 && (
            <span className="text-[10px] font-mono font-medium text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded hidden sm:inline">
              v{skill.current_version}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
