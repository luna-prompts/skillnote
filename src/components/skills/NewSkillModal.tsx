'use client'
import { useState, useCallback, useEffect, KeyboardEvent } from 'react'
import { Plus, X, BookOpen, Loader2, AlertCircle, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createSkill } from '@/lib/skills-store'
import { validateSkillName, validateDescription, normalizeSkillName, NAME_MAX, DESC_MAX, type ValidationError } from '@/lib/skill-validation'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

type NewSkillModalProps = {
  onClose: () => void
  collections: string[]
}

function FieldError({ errors }: { errors: ValidationError[] }) {
  if (errors.length === 0) return null
  return (
    <div className="mt-1 space-y-0.5">
      {errors.map((e, i) => (
        <p key={i} className="text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {e.message}
        </p>
      ))}
    </div>
  )
}

function CharCounter({ current, max }: { current: number; max: number }) {
  const pct = current / max
  return (
    <span className={`text-[10px] tabular-nums ${pct > 0.9 ? 'text-destructive' : pct > 0.75 ? 'text-amber-500' : 'text-muted-foreground/50'}`}>
      {current}/{max}
    </span>
  )
}

export function NewSkillModal({ onClose, collections }: NewSkillModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [selectedCollections, setSelectedCollections] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const router = useRouter()

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const nameErrors = touched.name ? validateSkillName(name) : []
  const descErrors = touched.description ? validateDescription(description) : []
  const isValid = validateSkillName(name).length === 0 && validateDescription(description).length === 0

  const addTag = useCallback(() => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTagInput('')
  }, [tagInput, tags])

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() }
    if (e.key === 'Backspace' && !tagInput && tags.length) setTags(prev => prev.slice(0, -1))
  }

  const toggleCollection = (col: string) =>
    setSelectedCollections(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col])

  const handleSubmit = useCallback(async () => {
    setTouched({ name: true, description: true })
    if (!isValid) return
    setSaving(true)
    try {
      const skill = await createSkill({
        title: name.trim(),
        description: description.trim(),
        content_md: `---\nname: ${name.trim()}\ndescription: ${description.trim()}\n---\n\n# ${name.trim()}\n\n`,
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
  }, [name, description, tags, selectedCollections, isValid, router, onClose])

  const previewSlug = name.trim()
    ? name.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    : ''

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
          {/* Name field */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[12px] font-medium text-foreground">Name <span className="text-destructive">*</span></label>
              <CharCounter current={name.length} max={NAME_MAX} />
            </div>
            <input
              autoFocus
              value={name}
              onChange={e => setName(normalizeSkillName(e.target.value))}
              onBlur={() => setTouched(prev => ({ ...prev, name: true }))}
              placeholder="e.g. react-hooks-guide"
              maxLength={NAME_MAX}
              className={`w-full h-9 px-3 text-[13px] font-mono bg-muted/60 border rounded-lg focus:outline-none focus:ring-1 placeholder:text-muted-foreground/60 ${
                nameErrors.length > 0 ? 'border-destructive focus:ring-destructive' : 'border-border/60 focus:ring-ring'
              }`}
            />
            <FieldError errors={nameErrors} />
            {previewSlug && nameErrors.length === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Slug: <code className="font-mono">{previewSlug}</code>
              </p>
            )}
            <p className="mt-1 text-[10px] text-muted-foreground/50">
              Lowercase letters, numbers, and hyphens only. Max {NAME_MAX} chars.
            </p>
          </div>

          {/* Description field */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[12px] font-medium text-foreground">Description <span className="text-destructive">*</span></label>
              <CharCounter current={description.length} max={DESC_MAX} />
            </div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={() => setTouched(prev => ({ ...prev, description: true }))}
              placeholder={'Describe what this skill does AND when Claude should use it. Be specific \u2014 e.g. "Use whenever the user mentions PDFs, forms, document extraction, or any file-processing task."'}
              maxLength={DESC_MAX}
              rows={3}
              className={`w-full px-3 py-2 text-[13px] bg-muted/60 border rounded-lg focus:outline-none focus:ring-1 placeholder:text-muted-foreground/60 resize-none ${
                descErrors.length > 0 ? 'border-destructive focus:ring-destructive' : 'border-border/60 focus:ring-ring'
              }`}
            />
            <FieldError errors={descErrors} />
            <div className="mt-1.5 flex items-start gap-1.5 p-2 bg-blue-500/5 border border-blue-500/10 rounded-lg">
              <Info className="h-3 w-3 text-blue-500 mt-0.5 shrink-0" />
              <p className="text-[10px] text-blue-600 dark:text-blue-400 leading-relaxed">
                Include both <strong>what</strong> the skill does and <strong>when</strong> Claude should use it. Be pushy — Claude tends to under-trigger.
              </p>
            </div>
          </div>

          {/* Tags */}
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

          {/* Collections */}
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
            disabled={!isValid || saving}
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
