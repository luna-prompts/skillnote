'use client'
import { useState, useCallback, useEffect, KeyboardEvent } from 'react'
import { Plus, X, BookOpen, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createSkill } from '@/lib/skills-store'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

type NewSkillModalProps = {
  onClose: () => void
  collections: string[]
}

export function NewSkillModal({ onClose, collections }: NewSkillModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [selectedCollections, setSelectedCollections] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const addTag = useCallback(() => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTagInput('')
  }, [tagInput, tags])

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() }
    if (e.key === 'Backspace' && !tagInput && tags.length) setTags(prev => prev.slice(0, -1))
  }

  const toggleCollection = (name: string) =>
    setSelectedCollections(prev => prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name])

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) { toast.error('Title is required'); return }
    setSaving(true)
    try {
      const skill = await createSkill({
        title: title.trim(),
        description: description.trim(),
        content_md: `# ${title.trim()}\n\n`,
        tags,
        collections: selectedCollections,
      })
      toast.success(`Skill "${skill.title}" created`)
      onClose()
      router.push(`/skills/${skill.slug}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create skill')
    } finally {
      setSaving(false)
    }
  }, [title, description, tags, selectedCollections, router, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="new-skill-title" className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <h3 id="new-skill-title" className="text-sm font-semibold text-foreground flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            New Skill
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Title <span className="text-destructive">*</span></label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="e.g. React Hooks Guide"
              className="w-full h-9 px-3 text-[13px] bg-muted/60 border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/60"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of this skill"
              className="w-full h-9 px-3 text-[13px] bg-muted/60 border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/60"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Tags</label>
            <div className="flex flex-wrap gap-1.5 p-2 bg-muted/60 border border-border/60 rounded-lg min-h-[36px]">
              {tags.map(tag => (
                <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent text-[11px] font-mono rounded-md">
                  {tag}
                  <button onClick={() => setTags(prev => prev.filter(t => t !== tag))} className="hover:opacity-70"><X className="h-2.5 w-2.5" /></button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
                placeholder={tags.length === 0 ? 'type tag + Enter' : ''}
                className="flex-1 min-w-[80px] bg-transparent text-[12px] font-mono focus:outline-none placeholder:text-muted-foreground/50"
              />
            </div>
          </div>

          {collections.length > 0 && (
            <div>
              <label className="block text-[12px] font-medium text-foreground mb-1.5">Collection</label>
              <div className="flex flex-wrap gap-1.5">
                {collections.map(col => (
                  <button
                    key={col}
                    onClick={() => toggleCollection(col)}
                    className={`px-2.5 py-1 rounded-lg text-[12px] border transition-colors ${
                      selectedCollections.includes(col)
                        ? 'bg-accent/10 text-accent border-accent/30'
                        : 'bg-muted text-muted-foreground border-border/60 hover:text-foreground'
                    }`}
                  >
                    {col}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border/60 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="h-8 text-[13px]" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="h-8 text-[13px] gap-1.5 bg-foreground text-background hover:bg-foreground/90"
            disabled={!title.trim() || saving}
            onClick={handleSubmit}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create Skill
          </Button>
        </div>
      </div>
    </div>
  )
}
