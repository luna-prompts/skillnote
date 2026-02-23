'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar } from '@/components/layout/topbar'
import { mockTags } from '@/lib/mock-data'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Plus, Tag, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

const TAG_COLORS = ['bg-violet-500', 'bg-blue-500', 'bg-teal-500', 'bg-amber-500', 'bg-rose-500', 'bg-emerald-500', 'bg-indigo-500']

export default function TagsPage() {
  const [filter, setFilter] = useState('')
  const router = useRouter()
  const maxCount = Math.max(...mockTags.map(t => t.skill_count))
  const filtered = mockTags.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <>
      <TopBar />
      <main className="flex-1 p-4 sm:p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Tags</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">{mockTags.length} tags</p>
          </div>
          <Button size="sm" className="h-8 gap-1.5 text-[13px] bg-foreground hover:bg-foreground/90 text-background border-0">
            <Plus className="h-3.5 w-3.5" />
            New Tag
          </Button>
        </div>

        {/* Search */}
        <div className="relative sm:max-w-sm mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-[14px] w-[14px] text-muted-foreground pointer-events-none" />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="w-full pl-8 pr-4 py-1.5 text-[13px] bg-muted/60 rounded-lg border border-border/60 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/70 transition-all"
            placeholder="Filter tags..."
          />
        </div>

        {/* Desktop: Table view */}
        <div className="bg-card rounded-xl border border-border/60 overflow-hidden hidden sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40">
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tag</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Skills</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-48">Usage</th>
                <th className="py-3 px-5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tag, i) => (
                <tr
                  key={tag.id}
                  onClick={() => router.push(`/?tag=${tag.name}`)}
                  className={cn(
                    'border-b border-border/40 hover:bg-accent/[0.04] dark:hover:bg-accent/[0.06] active:bg-muted/50 transition-colors cursor-pointer',
                    i === filtered.length - 1 && 'border-b-0'
                  )}
                >
                  <td className="py-3.5 px-5">
                    <div className="flex items-center gap-2.5">
                      <span className={cn('w-2 h-2 rounded-full shrink-0', TAG_COLORS[i % TAG_COLORS.length])} />
                      <Badge variant="secondary" className="text-xs font-mono">{tag.name}</Badge>
                    </div>
                  </td>
                  <td className="py-3.5 px-5 text-muted-foreground text-xs tabular-nums">{tag.skill_count} skills</td>
                  <td className="py-3.5 px-5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent/60 rounded-full transition-all"
                          style={{ width: `${(tag.skill_count / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground/60 tabular-nums w-6 text-right">{tag.skill_count}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-5 text-right">
                    <div className="flex items-center justify-end gap-3" onClick={e => e.stopPropagation()}>
                      <button aria-label="Rename tag" className="text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                        Rename
                      </button>
                      <span className="text-border">·</span>
                      <button aria-label="Delete tag" className="text-[12px] text-destructive/70 hover:text-destructive transition-colors cursor-pointer">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-12 text-center">
                    <p className="text-[13px] text-muted-foreground">No tags match &ldquo;{filter}&rdquo;</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile: Compact list view */}
        <div className="space-y-1.5 pb-24 sm:hidden">
          {filtered.map((tag, i) => (
            <div
              key={tag.id}
              onClick={() => router.push(`/?tag=${tag.name}`)}
              className="bg-card rounded-lg border border-border/60 px-4 py-3 active:bg-muted/30 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className={cn('w-2 h-2 rounded-full shrink-0', TAG_COLORS[i % TAG_COLORS.length])} />
                  <span className="text-[13px] font-mono font-semibold text-foreground truncate">{tag.name}</span>
                  <span className="text-[11px] text-muted-foreground/60 tabular-nums shrink-0">{tag.skill_count}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                  <button aria-label="Rename tag" className="text-[12px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 min-h-[44px] flex items-center">
                    Rename
                  </button>
                  <button aria-label="Delete tag" className="text-[12px] text-destructive/70 hover:text-destructive transition-colors px-2 py-1.5 min-h-[44px] flex items-center">
                    Delete
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 pl-[18px]">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', TAG_COLORS[i % TAG_COLORS.length])}
                    style={{ width: `${(tag.skill_count / maxCount) * 100}%`, opacity: 0.6 }}
                  />
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-[13px] text-muted-foreground">No tags match &ldquo;{filter}&rdquo;</p>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
