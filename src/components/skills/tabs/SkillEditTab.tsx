'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { RotateCcw, Save, Loader2, X, AlertCircle, ArrowRight } from 'lucide-react'
import { NAME_MAX, DESC_MAX, slugFromName, normalizeSkillName, validateSkillName, validateDescription } from '@/lib/skill-validation'
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
  skillCollections?: string[]
  setSkillCollections?: (collections: string[]) => void
  openFullscreen?: boolean
  /** 'edit' shows Discard/Cancel/Save; 'create' shows Cancel/Create Skill */
  mode?: 'edit' | 'create'
  saving?: boolean
  /** Active version number of the skill being edited */
  currentVersion?: number
  /** Total versions created (used for next version counter) */
  latestVersion?: number
}

export function SkillEditTab({
  editorContent, setEditorContent, editorDirty, onDiscard, onSave, onCancel,
  skillTitle, setSkillTitle, skillDescription, setSkillDescription,
  skillSlug, skillCollections = [], setSkillCollections,
  openFullscreen, mode = 'edit', saving = false, currentVersion, latestVersion,
}: SkillEditTabProps) {
  const [fullscreen, setFullscreen] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [showSaveConfirm, setShowSaveConfirm] = useState(false)
  const [collectionInput, setCollectionInput] = useState('')
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

  const nextVersion = currentVersion ? currentVersion + 1 : 1
  const previewSlug = skillSlug || (skillTitle.trim() ? slugFromName(skillTitle.trim()) : '')

  const handleNameChange = (value: string) => {
    setSkillTitle(normalizeSkillName(value))
  }

  const addCollection = useCallback(() => {
    const c = collectionInput.trim()
    if (c && !skillCollections.includes(c)) setSkillCollections?.([...skillCollections, c])
    setCollectionInput('')
  }, [collectionInput, skillCollections, setSkillCollections])

  /** Validate fields, then either save directly (create) or show confirmation (edit) */
  const handleSaveClick = useCallback(() => {
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
    if (mode === 'edit' && currentVersion) {
      setShowSaveConfirm(true)
    } else {
      onSave()
    }
  }, [skillTitle, skillDescription, mode, currentVersion, onSave])

  const confirmSave = useCallback(() => {
    setShowSaveConfirm(false)
    onSave()
  }, [onSave])

  const saveButtonLabel = mode === 'create'
    ? 'Create Skill'
    : currentVersion ? `Save as v${nextVersion}` : 'Save'

  /* Footer bar — shared between fullscreen and inline modes */
  const footerContent = (
    <>
      <div className="flex items-center gap-2">
        {mode === 'edit' && currentVersion && (
          <span className="text-[11px] font-mono text-muted-foreground/60 tabular-nums hidden sm:inline">v{currentVersion} → v{nextVersion}</span>
        )}
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
          onClick={handleSaveClick}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saveButtonLabel}
        </Button>
      </div>
    </>
  )

  /* Save confirmation popup — edit mode only */
  const saveConfirmDialog = showSaveConfirm && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 animate-in fade-in duration-150" onClick={() => setShowSaveConfirm(false)}>
      <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-2xl p-6 animate-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
        {/* Version transition — the hero of the dialog */}
        <div className="flex items-center justify-center gap-3 mb-5">
          <div className="flex flex-col items-center">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1">Current</span>
            <span className="text-2xl font-bold font-mono text-muted-foreground/50">v{currentVersion}</span>
          </div>
          <ArrowRight className="h-5 w-5 text-muted-foreground/40 mt-4" />
          <div className="flex flex-col items-center">
            <span className="text-[10px] uppercase tracking-widest text-accent mb-1">New</span>
            <span className="text-2xl font-bold font-mono text-foreground">v{nextVersion}</span>
          </div>
        </div>

        <p className="text-[13px] text-muted-foreground text-center mb-1">
          New version of
        </p>
        <p className="text-[13px] font-mono text-foreground/80 text-center mb-5">
          {previewSlug || skillTitle}
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" className="h-8 min-h-[44px] sm:min-h-0 text-[13px]" onClick={() => setShowSaveConfirm(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 min-h-[44px] sm:min-h-0 gap-1.5 text-[13px] bg-foreground text-background hover:bg-foreground/90"
            disabled={saving}
            onClick={confirmSave}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save v{nextVersion}
          </Button>
        </div>
      </div>
    </div>
  )

  /* Metadata section — name, slug, description */
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

      {/* Collections — inline editor */}
      {setSkillCollections && (
        <div className="mb-6">
          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-2 block">Collections</label>
          <div className="flex flex-wrap items-center gap-1.5">
            {skillCollections.map(col => (
              <span key={col} className="flex items-center gap-1 px-2 py-0.5 bg-muted text-foreground/70 text-[11px] rounded-md">
                {col}
                <button onClick={() => setSkillCollections(skillCollections.filter(c => c !== col))} className="hover:opacity-70"><X className="h-2.5 w-2.5" /></button>
              </span>
            ))}
            <input
              value={collectionInput}
              onChange={e => setCollectionInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCollection() }
                if (e.key === 'Backspace' && !collectionInput && skillCollections.length) setSkillCollections(skillCollections.slice(0, -1))
              }}
              onBlur={addCollection}
              placeholder={skillCollections.length === 0 ? '+ Add to collection' : ''}
              className="min-w-[80px] bg-transparent text-[12px] text-muted-foreground focus:outline-none placeholder:text-muted-foreground/30"
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
      <>
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
              skillMeta={{ name: skillTitle, description: skillDescription }}
              onMetaChange={(meta) => {
                setSkillTitle(normalizeSkillName(meta.name))
                setSkillDescription(meta.description)
              }}
              renderToolbar={(toolbar) => (
                <div className="sticky top-0 z-10 border-b border-border/40">
                  {toolbar}
                </div>
              )}
            />
          </div>
        </div>
        {saveConfirmDialog}
      </>
    )
  }

  // Inline (non-fullscreen) edit — just the editor with footer
  return (
    <>
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
      {saveConfirmDialog}
    </>
  )
}
