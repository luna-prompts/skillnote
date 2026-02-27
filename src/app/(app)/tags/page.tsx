'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar } from '@/components/layout/topbar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { saveSkills, getSkills } from '@/lib/skills-store'
import { renameTagApi, deleteTagApi, fetchTagsApi } from '@/lib/api/skills'
import { toast } from 'sonner'

const TAG_COLORS = ['bg-violet-500', 'bg-blue-500', 'bg-teal-500', 'bg-amber-500', 'bg-rose-500', 'bg-emerald-500', 'bg-indigo-500']

type Tag = { name: string; skill_count: number }

export default function TagsPage() {
  const [filter, setFilter] = useState('')
  const [tags, setTags] = useState<Tag[]>([])
  const [renamingTag, setRenamingTag] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingTag, setDeletingTag] = useState<string | null>(null)
  const router = useRouter()

  async function loadTags() {
    try {
      const data = await fetchTagsApi()
      setTags(data)
    } catch {
      // fall back to deriving from localStorage
      const skills = getSkills()
      const counts = new Map<string, number>()
      skills.forEach(s => (s.tags || []).forEach(t => counts.set(t, (counts.get(t) ?? 0) + 1)))
      setTags(Array.from(counts.entries()).map(([name, skill_count]) => ({ name, skill_count })))
    }
  }

  useEffect(() => { loadTags() }, [])

  const maxCount = Math.max(1, ...tags.map(t => t.skill_count))
  const filtered = tags.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()))

  async function handleRename() {
    if (!renamingTag || !renameValue.trim()) return
    try {
      await renameTagApi(renamingTag, renameValue.trim())
      const skills = getSkills()
      const updated = skills.map(s => ({
        ...s,
        tags: (s.tags || []).map(t => t === renamingTag ? renameValue.trim() : t)
      }))
      saveSkills(updated)
      toast.success(`Tag renamed to "${renameValue.trim()}"`)
      setRenamingTag(null)
      await loadTags()
    } catch {
      toast.error('Failed to rename tag')
    }
  }

  async function handleTagDelete() {
    if (!deletingTag) return
    try {
      await deleteTagApi(deletingTag)
      const skills = getSkills()
      const updated = skills.map(s => ({
        ...s,
        tags: (s.tags || []).filter(t => t !== deletingTag)
      }))
      saveSkills(updated)
      toast.success(`Tag "${deletingTag}" deleted`)
      setDeletingTag(null)
      await loadTags()
    } catch {
      toast.error('Failed to delete tag')
    }
  }

  return (
    <>
      <TopBar />
      <main className="flex-1 p-4 sm:p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Tags</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">{tags.length} tags</p>
          </div>
          <Button size="sm" className="h-8 gap-1.5 text-[13px] bg-foreground hover:bg-foreground/90 text-background border-0" disabled>
            <Plus className="h-3.5 w-3.5" />
            New Tag
          </Button>
        </div>

        <div className="relative sm:max-w-sm mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-[14px] w-[14px] text-muted-foreground pointer-events-none" />
          <input value={filter} onChange={e => setFilter(e.target.value)} className="w-full pl-8 pr-4 py-1.5 text-[13px] bg-muted/60 rounded-lg border border-border/60 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/70 transition-all" placeholder="Filter tags..." />
        </div>

        <div className="bg-card rounded-xl border border-border/60 overflow-hidden hidden sm:block">
          <table className="w-full text-sm"><thead><tr className="border-b border-border/60 bg-muted/40"><th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tag</th><th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Skills</th><th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-48">Usage</th><th className="py-3 px-5"></th></tr></thead>
            <tbody>
              {filtered.map((tag, i) => (
                <tr key={tag.name} onClick={() => router.push(`/?tag=${tag.name}`)} className={cn('border-b border-border/40 hover:bg-accent/[0.04] dark:hover:bg-accent/[0.06] active:bg-muted/50 transition-colors cursor-pointer', i === filtered.length - 1 && 'border-b-0')}>
                  <td className="py-3.5 px-5"><div className="flex items-center gap-2.5"><span className={cn('w-2 h-2 rounded-full shrink-0', TAG_COLORS[i % TAG_COLORS.length])} /><Badge variant="secondary" className="text-xs font-mono">{tag.name}</Badge></div></td>
                  <td className="py-3.5 px-5 text-muted-foreground text-xs tabular-nums">{tag.skill_count} skills</td>
                  <td className="py-3.5 px-5"><div className="flex items-center gap-2"><div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-accent/60 rounded-full transition-all" style={{ width: `${(tag.skill_count / maxCount) * 100}%` }} /></div><span className="text-[11px] text-muted-foreground/60 tabular-nums w-6 text-right">{tag.skill_count}</span></div></td>
                  <td className="py-3.5 px-5 text-right"><div className="flex items-center justify-end gap-3" onClick={e => e.stopPropagation()}><button onClick={() => { setRenamingTag(tag.name); setRenameValue(tag.name) }} className="text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer">Rename</button><span className="text-border">·</span><button onClick={() => setDeletingTag(tag.name)} className="text-[12px] text-destructive/70 hover:text-destructive transition-colors cursor-pointer">Delete</button></div></td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={4} className="py-12 text-center"><p className="text-[13px] text-muted-foreground">No tags match &ldquo;{filter}&rdquo;</p></td></tr>}
            </tbody></table>
        </div>

        {/* Mobile list — shown only below sm */}
        <div className="sm:hidden space-y-2 mt-4">
          {filtered.map((tag, i) => (
            <div key={tag.name || String(i)} className="flex items-center justify-between p-3 bg-card border border-border/60 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] font-medium">{tag.name}</span>
                <span className="text-[11px] text-muted-foreground">{tag.skill_count} skill{tag.skill_count !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => { setRenamingTag(tag.name); setRenameValue(tag.name) }} className="text-[12px] text-muted-foreground hover:text-foreground">Rename</button>
                <button onClick={() => setDeletingTag(tag.name)} className="text-[12px] text-destructive/70 hover:text-destructive">Delete</button>
              </div>
            </div>
          ))}
        </div>

        {/* Rename modal */}
        {renamingTag && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setRenamingTag(null)}>
            <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-foreground mb-4">Rename tag &ldquo;{renamingTag}&rdquo;</h3>
              <input
                autoFocus
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRename()}
                className="w-full h-9 px-3 text-[13px] bg-muted/60 border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring mb-4"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" className="h-8 text-[13px]" onClick={() => setRenamingTag(null)}>Cancel</Button>
                <Button size="sm" className="h-8 text-[13px] bg-foreground text-background hover:bg-foreground/90" onClick={handleRename} disabled={!renameValue.trim()}>Rename</Button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirm modal */}
        {deletingTag && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeletingTag(null)}>
            <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-foreground mb-2">Delete tag &ldquo;{deletingTag}&rdquo;?</h3>
              <p className="text-[13px] text-muted-foreground mb-5">This will remove the tag from all skills. This cannot be undone.</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" className="h-8 text-[13px]" onClick={() => setDeletingTag(null)}>Cancel</Button>
                <Button variant="destructive" size="sm" className="h-8 text-[13px]" onClick={handleTagDelete}>Delete</Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
