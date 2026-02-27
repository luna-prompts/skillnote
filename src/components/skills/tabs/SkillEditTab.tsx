'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { RotateCcw, Save, Loader2, X, AlertCircle } from 'lucide-react'
import { NAME_MAX, DESC_MAX, slugFromName, validateSkillName, validateDescription, type ValidationError } from '@/lib/skill-validation'
import { Button } from '@/components/ui/button'
import { WysiwygEditor, type EditorMode } from '@/components/skills/WysiwygEditor'
import { FieldError } from '@/components/skills/FieldError'

type SkillEditTabProps = {
  editorContent: string
  setEditorContent: (content: string) => void
  editorDirty: boolean
  onDiscard: () => void
  onSave: () => void
  onCancel: () => void
  skillTitle: string
  setSkillTitle: (title: string) => void
  skillDescription: string
  setSkillDescription: (desc: string) => void
  skillSlug?: string
  skillTags?: string[]
  setSkillTags?: (tags: string[]) => void
  openFullscreen?: boolean
  /** 'edit' shows Discard/Cancel/Save; 'create' shows Cancel/Create Skill */
  mode?: 'edit' | 'create'
  saving?: boolean
}

export function SkillEditTab({
  editorContent, setEditorContent, editorDirty, onDiscard, onSave, onCancel,
  skillTitle, setSkillTitle, skillDescription, setSkillDescription,
  skillSlug, skillTags = [], setSkillTags, openFullscreen,
  mode = 'edit', saving = false,
}: SkillEditTabProps) {
  const [fullscreen, setFullscreen] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [tagInput, setTagInput] = useState('')
  const [editorMode, setEditorMode] = useState<EditorMode>('wysiwyg')
  const nameRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)

  // Auto-open fullscreen when requested on mount
  useEffect(() => {
    if (openFullscreen) setFullscreen(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-focus name in create mode
  useEffect(() => {
    if (mode === 'create') {
      setTimeout(() => nameRef.current?.focus(), 100)
    }
  }, [mode])

  // Auto-resize description textarea when value changes (e.g. edit mode load, raw mode sync)
  useEffect(() => {
    if (descRef.current) {
      descRef.current.style.height = 'auto'
      descRef.current.style.height = descRef.current.scrollHeight + 'px'
    }
  }, [skillDescription])

  // Escape in fullscreen → cancel
  useEffect(() => {
    if (!fullscreen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [fullscreen, onCancel])

  const nameErrors = touched.name ? validateSkillName(skillTitle) : []
  const descErrors = touched.description ? validateDescription(skillDescription) : []
  const isValid = validateSkillName(skillTitle).length === 0 && validateDescription(skillDescription).length === 0

  const previewSlug = skillSlug || (skillTitle.trim() ? slugFromName(skillTitle.trim()) : '')

  const handleNameChange = (value: string) => {
    // In create mode, restrict to valid slug characters; in edit mode allow free editing
    if (mode === 'create') {
      setSkillTitle(value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
    } else {
      setSkillTitle(value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
    }
  }

  const addTag = useCallback(() => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !skillTags.includes(t)) setSkillTags?.([...skillTags, t])
    setTagInput('')
  }, [tagInput, skillTags, setSkillTags])

  /* Footer bar — shared between fullscreen and inline modes */
  const footerContent = (
    <>
      <div className="flex items-center gap-2">
        {editorDirty && mode === 'edit' && (
          <span className="text-[11px] text-amber-500 font-medium items-center gap-1 hidden sm:flex">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Unsaved changes
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {editorDirty && mode === 'edit' && (
          <Button variant="ghost" size="sm" className="h-8 min-h-[44px] sm:min-h-0 text-[13px] text-muted-foreground hover:text-destructive gap-1.5" onClick={onDiscard}>
            <RotateCcw className="h-3 w-3" />
            Discard
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-8 min-h-[44px] sm:min-h-0 text-[13px]" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-8 min-h-[44px] sm:min-h-0 gap-1.5 text-[13px] bg-foreground text-background hover:bg-foreground/90"
          disabled={saving}
          onClick={() => {
            setTouched({ name: true, description: true })
            const nErrs = validateSkillName(skillTitle)
            const dErrs = validateDescription(skillDescription)
            if (nErrs.length > 0) {
              if (nameRef.current) {
                nameRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
                nameRef.current.focus()
              }
              return
            }
            if (dErrs.length > 0) {
              if (descRef.current) {
                descRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
                descRef.current.focus()
              }
              return
            }
            onSave()
          }}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {mode === 'create' ? 'Create Skill' : 'Save'}
        </Button>
      </div>
    </>
  )

  /* Metadata section — name, slug, description, tags */
  const metadataSection = (
    <div className="px-6 sm:px-10 pt-6 pb-4">
      {/* Name */}
      <div className="mb-1">
        <div className="flex items-center gap-2 mb-2">
          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">Name</label>
        </div>
        <input
          ref={nameRef}
          value={skillTitle}
          onChange={e => handleNameChange(e.target.value)}
          onBlur={() => setTouched(prev => ({ ...prev, name: true }))}
          placeholder="skill-name"
          maxLength={NAME_MAX}
          className="w-full text-3xl sm:text-4xl font-bold font-mono text-foreground bg-transparent border-none outline-none focus:outline-none placeholder:text-muted-foreground/20 tracking-tight leading-tight"
          style={{ outline: 'none', boxShadow: 'none', border: 'none' }}
        />
      </div>
      <div className="flex items-center gap-3 mb-1">
        {previewSlug && (
          <code className="text-[11px] font-mono text-muted-foreground/50">{previewSlug}/SKILL.md</code>
        )}
        <span className={`text-[10px] tabular-nums ${skillTitle.length > NAME_MAX * 0.9 ? 'text-destructive' : 'text-muted-foreground/40'}`}>
          {skillTitle.length}/{NAME_MAX}
        </span>
        {editorDirty && mode === 'edit' && <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" title="Unsaved changes" />}
      </div>
      {!skillTitle && !touched.name && (
        <p className="text-[11px] text-muted-foreground/50 mb-2">Lowercase letters, numbers, and hyphens only. This becomes the skill&apos;s folder name.</p>
      )}
      <div className="mb-4">
        <FieldError errors={nameErrors} />
      </div>

      {/* Description */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">Description</label>
        </div>
        <textarea
          ref={descRef}
          value={skillDescription}
          onChange={e => {
            setSkillDescription(e.target.value)
            // Auto-resize: reset height then set to scrollHeight
            e.target.style.height = 'auto'
            e.target.style.height = e.target.scrollHeight + 'px'
          }}
          onBlur={() => setTouched(prev => ({ ...prev, description: true }))}
          placeholder="Describe what this skill does and when Claude should use it..."
          maxLength={DESC_MAX}
          rows={2}
          className="w-full text-[15px] text-muted-foreground bg-transparent border-none outline-none focus:outline-none placeholder:text-muted-foreground/25 resize-none leading-relaxed overflow-hidden"
          style={{ outline: 'none', boxShadow: 'none', border: 'none' }}
        />
        <div className="flex items-center justify-between mt-1">
          <FieldError errors={descErrors} />
          <span className={`text-[10px] tabular-nums ${skillDescription.length > DESC_MAX * 0.9 ? 'text-destructive' : 'text-muted-foreground/40'}`}>
            {skillDescription.length}/{DESC_MAX}
          </span>
        </div>
      </div>

      {/* Tags — inline editor */}
      {setSkillTags && (
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-1.5">
            {skillTags.map(tag => (
              <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent text-[11px] font-mono rounded-md">
                {tag}
                <button onClick={() => setSkillTags(skillTags.filter(t => t !== tag))} className="hover:opacity-70"><X className="h-2.5 w-2.5" /></button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() }
                if (e.key === 'Backspace' && !tagInput && skillTags.length) setSkillTags(skillTags.slice(0, -1))
              }}
              onBlur={addTag}
              placeholder={skillTags.length === 0 ? '+ Add tags' : ''}
              className="min-w-[80px] bg-transparent text-[12px] font-mono text-muted-foreground focus:outline-none placeholder:text-muted-foreground/30"
            />
          </div>
        </div>
      )}

      <hr className="border-border/40" />
    </div>
  )

  // Fullscreen mode (always used in edit, always used in create)
  if (fullscreen || mode === 'create') {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        {/* Top bar */}
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border/60">
          {footerContent}
        </div>

        {/* Main content — scrollable */}
        <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
          {/* Hide metadata in raw mode — frontmatter is inline in the raw textarea */}
          {editorMode !== 'raw' && metadataSection}

          {/* Editor — toolbar uses sticky inside the scroll container */}
          <WysiwygEditor
            value={editorContent}
            onChange={setEditorContent}
            onModeChange={setEditorMode}
            className="min-h-[80vh]"
            skillMeta={{ name: skillTitle, description: skillDescription, tags: skillTags }}
            onMetaChange={(meta) => {
              setSkillTitle(meta.name)
              setSkillDescription(meta.description)
              if (meta.tags && setSkillTags) setSkillTags(meta.tags)
            }}
            renderToolbar={(toolbar) => (
              <div className="sticky top-0 z-10 border-b border-border/40">
                {toolbar}
              </div>
            )}
          />
        </div>
      </div>
    )
  }

  // Inline (non-fullscreen) edit — just the editor with footer
  return (
    <div className="flex-1 flex flex-col mt-0 animate-in fade-in duration-200 pb-16 min-h-0">
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <WysiwygEditor
          value={editorContent}
          onChange={setEditorContent}
        />
      </div>
      <div className="fixed bottom-16 lg:bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-t border-border/50 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 safe-area-bottom">
        {footerContent}
      </div>
    </div>
  )
}
