'use client'
import { useState, useEffect } from 'react'
import { FileText, Maximize2, RotateCcw, Save } from 'lucide-react'
import { DESC_MAX } from '@/lib/skill-validation'
import { Button } from '@/components/ui/button'
import { WysiwygEditor } from '@/components/skills/WysiwygEditor'

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
  openFullscreen?: boolean
}

export function SkillEditTab({ editorContent, setEditorContent, editorDirty, onDiscard, onSave, onCancel, skillTitle, setSkillTitle, skillDescription, setSkillDescription, openFullscreen }: SkillEditTabProps) {
  const [fullscreen, setFullscreen] = useState(false)

  // Auto-open fullscreen when requested on mount
  useEffect(() => {
    if (openFullscreen) setFullscreen(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape in fullscreen → return to view (cancel)
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

  const footerContent = (
    <>
      <div className="flex items-center gap-2">
        {editorDirty && (
          <span className="text-[11px] text-amber-500 font-medium items-center gap-1 hidden sm:flex">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Unsaved changes
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {editorDirty && (
          <Button variant="ghost" size="sm" className="h-8 min-h-[44px] sm:min-h-0 text-[13px] text-muted-foreground hover:text-destructive gap-1.5" onClick={onDiscard}>
            <RotateCcw className="h-3 w-3" />
            Discard
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-8 min-h-[44px] sm:min-h-0 text-[13px]" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" className="h-8 min-h-[44px] sm:min-h-0 gap-1.5 text-[13px] bg-foreground text-background hover:bg-foreground/90" onClick={onSave}>
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>
      </div>
    </>
  )

  const stickyFooter = (
    <div className="shrink-0 bg-background/95 backdrop-blur-sm border-t border-border/50 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 safe-area-bottom">
      {footerContent}
    </div>
  )

  const fixedFooter = (
    <div className="fixed bottom-16 lg:bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-t border-border/50 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 safe-area-bottom">
      {footerContent}
    </div>
  )

  // Fullscreen mode
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        {/* Header — title input only; Save/Cancel/Discard stay in the sticky footer */}
        <div className="flex items-center gap-2 px-6 sm:px-10 pt-6 pb-2 bg-background shrink-0">
          <input
            value={skillTitle}
            onChange={(e) => setSkillTitle(e.target.value)}
            className="flex-1 min-w-0 text-[28px] sm:text-[32px] font-bold text-foreground bg-transparent border-none outline-none focus:outline-none ring-0 focus:ring-0 shadow-none placeholder:text-muted-foreground/30 leading-tight tracking-tight"
            style={{ outline: 'none', boxShadow: 'none', border: 'none' }}
            placeholder="Untitled"
          />
          {editorDirty && <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0 mt-1" title="Unsaved changes" />}
        </div>

        {/* File bar */}
        <div className="flex items-center gap-2 px-6 sm:px-10 pb-2 shrink-0">
          <FileText className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          <span className="font-mono text-[12px] text-muted-foreground/50 shrink-0">SKILL.md</span>
        </div>
        {/* Description input */}
        <div className="px-6 sm:px-10 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-medium text-muted-foreground/60">Description</label>
            <span className={`text-[10px] tabular-nums ${skillDescription.length > DESC_MAX * 0.9 ? 'text-destructive' : 'text-muted-foreground/40'}`}>
              {skillDescription.length}/{DESC_MAX}
            </span>
          </div>
          <textarea
            value={skillDescription}
            onChange={(e) => setSkillDescription(e.target.value)}
            placeholder="What this skill does and when Claude should use it..."
            rows={2}
            maxLength={DESC_MAX}
            className="w-full px-3 py-2 text-[13px] bg-muted/40 border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30 resize-none"
          />
        </div>
        <hr className="border-border/40 shrink-0" />

        {/* Editor fills remaining height */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <WysiwygEditor
            value={editorContent}
            onChange={setEditorContent}
          />
        </div>

        {stickyFooter}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col mt-0 animate-in fade-in duration-200 pb-16 min-h-0">
      {/* File header bar */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-mono text-[13px] text-muted-foreground shrink-0">SKILL.md</span>
        </div>
        {/* Fullscreen button */}
        <button
          onClick={() => setFullscreen(true)}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors hidden sm:flex items-center justify-center"
          title="Fullscreen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <hr className="border-border/40 mx-0 shrink-0" />

      {/* WYSIWYG editor — flex-1 fills the column */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <WysiwygEditor
          value={editorContent}
          onChange={setEditorContent}
        />
      </div>

      {fixedFooter}
    </div>
  )
}
