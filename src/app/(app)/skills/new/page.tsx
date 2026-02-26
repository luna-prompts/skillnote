'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { ArrowLeft, Save, Loader2, Info, X, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WysiwygEditor } from '@/components/skills/WysiwygEditor'
import { createSkill } from '@/lib/skills-store'
import { validateSkillName, validateDescription, NAME_MAX, DESC_MAX, slugFromName, type ValidationError } from '@/lib/skill-validation'
import { parseFrontmatter } from '@/lib/frontmatter'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

function FieldError({ errors }: { errors: ValidationError[] }) {
  if (errors.length === 0) return null
  return (
    <div className="space-y-0.5">
      {errors.map((e, i) => (
        <p key={i} className="text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {e.message}
        </p>
      ))}
    </div>
  )
}

export default function NewSkillPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const router = useRouter()
  const nameRef = useRef<HTMLInputElement>(null)

  // Auto-focus name on mount (slight delay to avoid hydration blur)
  useEffect(() => { setTimeout(() => nameRef.current?.focus(), 100) }, [])

  // Escape → go back
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).isContentEditable &&
          !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        router.push('/')
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [router])

  // Cmd+S → save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })

  const nameErrors = touched.name ? validateSkillName(name) : []
  const descErrors = touched.description ? validateDescription(description) : []
  const isValid = validateSkillName(name).length === 0 && validateDescription(description).length === 0

  const addTag = useCallback(() => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTagInput('')
  }, [tagInput, tags])

  // When editor content changes, check if it has frontmatter that should be extracted
  const handleContentChange = useCallback((md: string) => {
    setContent(md)
    // Auto-extract frontmatter from pasted content
    if (md.trimStart().startsWith('---')) {
      const { data, body } = parseFrontmatter(md)
      if (data.name && typeof data.name === 'string' && !name) {
        setName(data.name.toLowerCase().replace(/[^a-z0-9-]/g, ''))
      }
      if (data.description && typeof data.description === 'string' && !description) {
        setDescription(String(data.description))
      }
    }
  }, [name, description])

  const handleSave = useCallback(async () => {
    setTouched({ name: true, description: true })
    if (validateSkillName(name).length > 0 || validateDescription(description).length > 0) return
    setSaving(true)
    try {
      // Build content_md with proper frontmatter
      const frontmatter = `---\nname: ${name.trim()}\ndescription: ${description.trim()}\n---\n\n`
      const bodyContent = content.trim() || `# ${name.trim()}\n\n`
      const fullContent = frontmatter + bodyContent

      const skill = await createSkill({
        title: name.trim(),
        description: description.trim(),
        content_md: fullContent,
        tags,
        collections: [],
      })
      toast.success(`"${skill.title}" created`)
      router.push(`/skills/${skill.slug}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create skill')
    } finally {
      setSaving(false)
    }
  }, [name, description, content, tags, router])

  const previewSlug = name.trim() ? slugFromName(name.trim()) : ''

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Top bar */}
      <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border/60">
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-[13px]"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back to Skills</span>
        </button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[13px]"
            onClick={() => router.push('/')}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 text-[13px] gap-1.5 bg-foreground text-background hover:bg-foreground/90"
            disabled={!isValid || saving}
            onClick={handleSave}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Create Skill
          </Button>
        </div>
      </div>

      {/* Main content — scrollable */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8">
          {/* Name — large inline input */}
          <div className="mb-1">
            <input
              ref={nameRef}
              value={name}
              onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              onBlur={() => setTouched(prev => ({ ...prev, name: true }))}
              placeholder="skill-name"
              maxLength={NAME_MAX}
              className="w-full text-3xl sm:text-4xl font-bold font-mono text-foreground bg-transparent border-none outline-none focus:outline-none placeholder:text-muted-foreground/20 tracking-tight leading-tight"
              style={{ outline: 'none', boxShadow: 'none', border: 'none' }}
            />
          </div>
          <div className="flex items-center gap-3 mb-4">
            {previewSlug && (
              <code className="text-[11px] font-mono text-muted-foreground/50">{previewSlug}/SKILL.md</code>
            )}
            <span className={`text-[10px] tabular-nums ${name.length > NAME_MAX * 0.9 ? 'text-destructive' : 'text-muted-foreground/40'}`}>
              {name.length}/{NAME_MAX}
            </span>
          </div>
          <FieldError errors={nameErrors} />

          {/* Description */}
          <div className="mb-6">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={() => setTouched(prev => ({ ...prev, description: true }))}
              placeholder="Describe what this skill does and when Claude should use it..."
              maxLength={DESC_MAX}
              rows={2}
              className="w-full text-[15px] text-muted-foreground bg-transparent border-none outline-none focus:outline-none placeholder:text-muted-foreground/25 resize-none leading-relaxed"
              style={{ outline: 'none', boxShadow: 'none', border: 'none' }}
            />
            <div className="flex items-center justify-between mt-1">
              <FieldError errors={descErrors} />
              <span className={`text-[10px] tabular-nums ${description.length > DESC_MAX * 0.9 ? 'text-destructive' : 'text-muted-foreground/40'}`}>
                {description.length}/{DESC_MAX}
              </span>
            </div>
            {!description && !touched.description && (
              <div className="mt-2 flex items-start gap-1.5 p-2.5 bg-blue-500/5 border border-blue-500/10 rounded-lg">
                <Info className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-[11px] text-blue-600 dark:text-blue-400 leading-relaxed">
                  Include both <strong>what</strong> the skill does and <strong>when</strong> Claude should use it.
                  Be pushy — Claude tends to under-trigger. Example: <em>"Extract text and tables from PDF files. Use whenever the user mentions PDFs, forms, or document extraction."</em>
                </p>
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="mb-6">
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map(tag => (
                <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent text-[11px] font-mono rounded-md">
                  {tag}
                  <button onClick={() => setTags(prev => prev.filter(t => t !== tag))} className="hover:opacity-70"><X className="h-2.5 w-2.5" /></button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() }
                  if (e.key === 'Backspace' && !tagInput && tags.length) setTags(prev => prev.slice(0, -1))
                }}
                onBlur={addTag}
                placeholder={tags.length === 0 ? '+ Add tags' : ''}
                className="min-w-[80px] bg-transparent text-[12px] font-mono text-muted-foreground focus:outline-none placeholder:text-muted-foreground/30"
              />
            </div>
          </div>

          <hr className="border-border/40 mb-4" />
        </div>

        {/* Editor — full width below the metadata */}
        <div className="max-w-3xl mx-auto px-0 sm:px-2 pb-20">
          <WysiwygEditor
            value={content}
            onChange={setContent}
          />
        </div>
      </div>
    </div>
  )
}
