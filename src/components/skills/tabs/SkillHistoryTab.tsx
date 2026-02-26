'use client'
import { useState } from 'react'
import { ChevronDown, ChevronRight, History } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { type Revision, type DiffLine } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

function getDiffSummary(diff: DiffLine[]): string {
  const added = diff.filter(d => d.type === 'add').length
  const removed = diff.filter(d => d.type === 'remove').length
  if (added === 0 && removed === 0) return 'Initial version'
  const parts: string[] = []
  if (added > 0) parts.push(`+${added} line${added > 1 ? 's' : ''}`)
  if (removed > 0) parts.push(`-${removed} line${removed > 1 ? 's' : ''}`)
  return parts.join(', ')
}

function DiffTable({ diff }: { diff: DiffLine[] }) {
  return (
    <div className="border-t border-border/60 bg-muted/20 overflow-x-auto">
      <table className="w-full text-[12px] font-mono">
        <tbody>
          {diff.map((line, idx) => (
            <tr key={idx} className={cn(
              line.type === 'add' && 'bg-green-500/10',
              line.type === 'remove' && 'bg-red-500/10',
            )}>
              <td className="w-10 px-2 py-0.5 text-right text-muted-foreground/40 select-none border-r border-border/30">{line.lineOld ?? ''}</td>
              <td className="w-10 px-2 py-0.5 text-right text-muted-foreground/40 select-none border-r border-border/30">{line.lineNew ?? ''}</td>
              <td className={cn('w-5 px-1 py-0.5 text-center select-none', line.type === 'add' && 'text-green-600 dark:text-green-400', line.type === 'remove' && 'text-red-600 dark:text-red-400', line.type === 'context' && 'text-muted-foreground/40')}>
                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
              </td>
              <td className={cn('px-3 py-0.5 whitespace-pre', line.type === 'add' && 'text-green-700 dark:text-green-300', line.type === 'remove' && 'text-red-700 dark:text-red-300', line.type === 'context' && 'text-foreground/70')}>
                {line.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HistoryRevision({ revision, isLast, checked, onCheck }: { revision: Revision; isLast: boolean; checked: boolean; onCheck: (rev: number) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [showRestore, setShowRestore] = useState(false)
  const initials = revision.author.split(' ').map(n => n[0]).join('')
  const summary = getDiffSummary(revision.diff)

  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center shrink-0">
        <div className={cn(
          'w-2.5 h-2.5 rounded-full border-2 mt-5 shrink-0',
          revision.latest ? 'bg-accent border-accent' : 'bg-card border-border'
        )} />
        {!isLast && <div className="w-px flex-1 bg-border/60 my-1" />}
      </div>
      <div className={cn('flex-1', !isLast && 'pb-6')}>
        <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
          <div className="flex items-start gap-3 p-4 hover:bg-muted/30 transition-colors">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onCheck(revision.rev)}
              className="rounded border-border accent-accent shrink-0 mt-1"
              aria-label={`Select revision ${revision.rev}`}
            />
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
              style={{ backgroundColor: revision.avatar_color }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <p className="text-[13px] font-medium text-foreground">Revision {revision.rev}</p>
                {revision.latest && <Badge className="text-[10px] py-0 bg-accent/15 text-accent border-accent/30">Latest</Badge>}
                {!revision.latest && (
                  <Button size="sm" variant="outline" className="h-7 text-[11px] sm:hidden" onClick={() => setShowRestore(true)}>Restore</Button>
                )}
              </div>
              <p className="text-[12px] text-muted-foreground">{revision.label}</p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                {revision.author} · {new Date(revision.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {summary !== 'Initial version' && (
                  <span className="text-[10px] font-mono text-muted-foreground/50 ml-2">{summary}</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!revision.latest && (
                <Button size="sm" variant="outline" className="h-8 text-[12px] hidden sm:flex" onClick={() => setShowRestore(true)}>Restore</Button>
              )}
              {revision.diff.length > 0 && (
                <button onClick={() => setExpanded(!expanded)} className="p-1 rounded-md hover:bg-muted text-muted-foreground transition-colors" aria-label="Toggle diff">
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              )}
            </div>
          </div>
          {expanded && revision.diff.length > 0 && <DiffTable diff={revision.diff} />}
        </div>
      </div>

      {showRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowRestore(false)}>
          <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">Restore revision {revision.rev}?</h3>
            <p className="text-[13px] text-muted-foreground mb-2">&ldquo;{revision.label}&rdquo;</p>
            {revision.diff.length > 0 && (
              <p className="text-[12px] text-muted-foreground/70 mb-4">This will apply {summary} compared to the previous version.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="h-8 text-[13px]" onClick={() => setShowRestore(false)}>Cancel</Button>
              <Button size="sm" className="h-8 text-[13px]" onClick={() => setShowRestore(false)}>Restore</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type SkillHistoryTabProps = {
  revisions: Revision[]
}

export function SkillHistoryTab({ revisions }: SkillHistoryTabProps) {
  const [compareRevs, setCompareRevs] = useState<Set<number>>(new Set())

  return (
    <div className="flex-1 px-6 sm:px-12 py-6 mt-0 overflow-auto animate-in fade-in duration-200">
      <div className="max-w-3xl">
        {revisions.length > 0 ? (
          <>
            {compareRevs.size === 2 && (
              <div className="mb-4 p-4 bg-card rounded-xl border border-border/60">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[13px] font-semibold text-foreground">Comparing Revision {[...compareRevs].sort((a, b) => a - b).join(' → ')}</h4>
                  <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => setCompareRevs(new Set())}>Clear</Button>
                </div>
                {(() => {
                  const revs = revisions.filter(r => compareRevs.has(r.rev)).sort((a, b) => a.rev - b.rev)
                  const combinedDiff = revs.flatMap(r => r.diff)
                  return combinedDiff.length > 0 ? <DiffTable diff={combinedDiff} /> : <p className="text-[12px] text-muted-foreground">No diff data available for these revisions.</p>
                })()}
              </div>
            )}
            {compareRevs.size > 0 && compareRevs.size < 2 && (
              <p className="text-[12px] text-muted-foreground mb-3">Select one more revision to compare.</p>
            )}
            {revisions.map((revision, i, arr) => (
              <HistoryRevision
                key={revision.rev}
                revision={revision}
                isLast={i === arr.length - 1}
                checked={compareRevs.has(revision.rev)}
                onCheck={(rev) => setCompareRevs(prev => {
                  const next = new Set(prev)
                  if (next.has(rev)) { next.delete(rev) } else if (next.size < 2) { next.add(rev) }
                  return next
                })}
              />
            ))}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <div className="w-12 h-12 rounded-xl bg-muted/80 flex items-center justify-center mb-4">
              <History className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <p className="text-[14px] font-medium text-foreground mb-1">No revision history yet</p>
            <p className="text-[13px] text-muted-foreground text-center max-w-xs">
              Revision history will appear here as the skill is edited and saved.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
