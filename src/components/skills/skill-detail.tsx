'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Download, Pencil, GitBranch, Check, BookOpen, ArrowLeft, Hash, Link2, Star, Command, X, Keyboard, FileText, Search, FolderOpen, Share2, MoreHorizontal, Trash2, Clock, Tag, User } from 'lucide-react'
import { Skill, type Comment } from '@/lib/mock-data'
import { getSkills, updateSkill, deleteSkillById, saveSkillEdit } from '@/lib/skills-store'
import { validateSkillName, validateDescription } from '@/lib/skill-validation'
import { generateMarkdown, triggerDownload } from '@/lib/markdown-utils'
import { createCommentApi } from '@/lib/api/skills'
import { toast } from 'sonner'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { SkillViewTab } from './tabs/SkillViewTab'
import { SkillEditTab } from './tabs/SkillEditTab'

type PaletteAction = {
  icon: React.ComponentType<{ className?: string }>
  label: string
  shortcut: string
  group: string
  action: () => void
}

function CommandPalette({ actions, onClose }: { actions: PaletteAction[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)

  const filtered = query
    ? actions.filter(a => a.label.toLowerCase().includes(query.toLowerCase()))
    : actions

  const groups = filtered.reduce<Record<string, PaletteAction[]>>((acc, a) => {
    ;(acc[a.group] ??= []).push(a)
    return acc
  }, {})

  const flatItems = Object.values(groups).flat()

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(prev => (prev + 1) % flatItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(prev => (prev - 1 + flatItems.length) % flatItems.length)
    } else if (e.key === 'Enter' && flatItems[selectedIdx]) {
      e.preventDefault()
      flatItems[selectedIdx].action()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  useEffect(() => { setSelectedIdx(0) }, [query])

  let itemIndex = 0
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50 animate-in fade-in duration-150" onClick={onClose}>
      <div className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            placeholder="Search commands, skills..."
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="text-[10px] font-mono text-muted-foreground/50 bg-muted px-1.5 py-0.5 rounded">esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-3 py-2">{group}</p>
              {items.map((item) => {
                const idx = itemIndex++
                return (
                  <button
                    key={`${group}-${item.label}`}
                    onClick={item.action}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                      idx === selectedIdx ? 'bg-accent/10 text-accent' : 'text-foreground hover:bg-muted'
                    )}
                  >
                    <item.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 text-left truncate">{item.label}</span>
                    {item.shortcut && <kbd className="text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{item.shortcut}</kbd>}
                  </button>
                )
              })}
            </div>
          ))}
          {flatItems.length === 0 && (
            <p className="text-[13px] text-muted-foreground text-center py-6">No results found</p>
          )}
        </div>
        <div className="px-4 py-2 border-t border-border/60 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded">↑↓</kbd> Navigate</span>
          <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded">↵</kbd> Execute</span>
          <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded">esc</kbd> Close</span>
        </div>
      </div>
    </div>
  )
}

export function SkillDetail({ skill, onSkillUpdated }: { skill: Skill; onSkillUpdated?: (s: Skill) => void }) {
  const [activeTab, setActiveTab] = useState('view')
  const [editorContent, setEditorContent] = useState(skill.content_md)
  const [titleValue, setTitleValue] = useState(skill.title)
  const [descriptionValue, setDescriptionValue] = useState(skill.description)
  const [tagsValue, setTagsValue] = useState<string[]>(skill.tags)
  const [starred, setStarred] = useState(false)

  // Sync state ONLY when the skill slug changes (navigating to a different skill)
  // or when content arrives for the first time (initial fetch fills empty content_md)
  const [lastSyncedSlug, setLastSyncedSlug] = useState(skill.slug)
  const [initialContentLoaded, setInitialContentLoaded] = useState(!!skill.content_md)
  useEffect(() => {
    if (skill.slug !== lastSyncedSlug) {
      // Different skill — reset everything
      setEditorContent(skill.content_md)
      setTitleValue(skill.title)
      setDescriptionValue(skill.description)
      setTagsValue(skill.tags)
      setLastSyncedSlug(skill.slug)
      setInitialContentLoaded(!!skill.content_md)
    } else if (!initialContentLoaded && skill.content_md) {
      // Same skill, but content just arrived from API (was empty from list cache)
      setEditorContent(skill.content_md)
      setTitleValue(skill.title)
      setDescriptionValue(skill.description)
      setTagsValue(skill.tags)
      setInitialContentLoaded(true)
    }
  }, [skill, lastSyncedSlug, initialContentLoaded])
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const router = useRouter()
  const mainRef = useRef<HTMLElement>(null)

  // Swipe gesture for prev/next skill navigation
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const allSkills = getSkills()
  const currentIdx = allSkills.findIndex(s => s.slug === skill.slug)
  const prevSkill = allSkills.length > 1 && currentIdx > 0 ? allSkills[currentIdx - 1] : null
  const nextSkill = allSkills.length > 1 && currentIdx < allSkills.length - 1 ? allSkills[currentIdx + 1] : null

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const onTouchStart = (e: TouchEvent) => {
      touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (!touchStartRef.current) return
      const dx = e.changedTouches[0].clientX - touchStartRef.current.x
      const dy = e.changedTouches[0].clientY - touchStartRef.current.y
      touchStartRef.current = null
      // Only trigger if horizontal swipe > 80px and more horizontal than vertical
      if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx > 0 && prevSkill) router.push(`/skills/${prevSkill.slug}`)
        else if (dx < 0 && nextSkill) router.push(`/skills/${nextSkill.slug}`)
      }
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [prevSkill, nextSkill, router])

  const editorDirty = editorContent !== skill.content_md || titleValue !== skill.title || descriptionValue !== skill.description || JSON.stringify(tagsValue) !== JSON.stringify(skill.tags)

  useEffect(() => {
    const saved = localStorage.getItem(`starred-${skill.slug}`)
    if (saved === 'true') setStarred(true)
  }, [skill.slug])

  const toggleStar = useCallback(() => {
    setStarred(prev => {
      localStorage.setItem(`starred-${skill.slug}`, String(!prev))
      return !prev
    })
  }, [skill.slug])

  const [showHelp, setShowHelp] = useState(false)
  const [saveToast, setSaveToast] = useState<'saving' | 'saved' | false>(false)
  const [savedVersion, setSavedVersion] = useState<number | null>(null)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleDiscard = useCallback(() => {
    setShowDiscardConfirm(true)
  }, [])

  const confirmDiscard = useCallback(() => {
    setEditorContent(skill.content_md)
    setTitleValue(skill.title)
    setDescriptionValue(skill.description)
    setTagsValue(skill.tags)
    setShowDiscardConfirm(false)
  }, [skill.content_md, skill.title, skill.description, skill.tags])

  const handleSave = useCallback(async () => {
    setSaveToast('saving')
    try {
      const updated = await saveSkillEdit(skill.slug, { title: titleValue, description: descriptionValue, content_md: editorContent, tags: tagsValue })
      onSkillUpdated?.(updated)
      setSavedVersion(updated.current_version)
      setSaveToast('saved')
      setActiveTab('view')
      setTimeout(() => setSaveToast(false), 1500)
    } catch {
      setSaveToast(false)
      toast.error('Failed to save')
    }
  }, [skill.slug, titleValue, descriptionValue, editorContent, tagsValue, onSkillUpdated])

  const handleCancel = useCallback(() => {
    setActiveTab('view')
  }, [])

  const handleExport = useCallback(() => {
    const md = generateMarkdown(skill)
    const blob = new Blob([md], { type: 'text/markdown' })
    triggerDownload(blob, `${skill.slug}.md`)
    toast.success(`Exported ${skill.slug}.md`)
  }, [skill])

  const handleDelete = useCallback(async () => {
    try {
      await deleteSkillById(skill.slug)
      toast.success(`"${skill.title}" deleted`)
      router.push('/')
    } catch {
      toast.error('Failed to delete skill')
    }
  }, [skill.slug, skill.title, router])

  const handleAddComment = useCallback(async (body: string): Promise<Comment | void> => {
    const comment = await createCommentApi(skill.slug, 'You', body)
    updateSkill(skill.slug, { comments: [...(skill.comments || []), comment] })
    toast.success('Comment added')
    return comment
  }, [skill.slug, skill.comments])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      if (e.key === '?' && !inInput) {
        e.preventDefault()
        setShowHelp(prev => !prev)
        return
      }
      if (e.key === 'Escape') {
        if (commandPaletteOpen) { setCommandPaletteOpen(false); return }
        if (showHelp) { setShowHelp(false); return }
        if (!inInput) { router.push('/'); return }
        return
      }
      if (e.key === 'e' && !inInput && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setActiveTab('edit')
        return
      }
      if (e.key === 'v' && !inInput && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setActiveTab('view')
        return
      }
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCommandPaletteOpen(prev => !prev)
        return
      }
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSave()
        return
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [commandPaletteOpen, showHelp, router, handleSave])

  // Hide sidebar when in edit mode
  useEffect(() => {
    if (activeTab === 'edit') {
      document.body.classList.add('skill-editing')
    } else {
      document.body.classList.remove('skill-editing')
    }
    return () => document.body.classList.remove('skill-editing')
  }, [activeTab])

  return (
    <>
      <TopBar showFab={false} />
      <div className="flex flex-1 overflow-hidden">
        <main ref={mainRef} className="flex-1 overflow-auto flex flex-col min-w-0">
          {/* Header — hero section */}
          <div className="shrink-0">
            {/* Top nav strip */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-2.5 border-b border-border/40">
              <div className="flex items-center gap-3">
                <button onClick={() => router.back()} className="text-muted-foreground hover:text-foreground transition-colors p-1 -ml-1 shrink-0 rounded-md hover:bg-muted/50" aria-label="Go back">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-1.5">
                  <FolderOpen className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                  <code className="font-mono text-[11px] text-muted-foreground/50 tracking-wide">{skill.slug}/SKILL.md</code>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" className="h-8 min-h-[44px] sm:min-h-0 text-[13px] text-muted-foreground px-2" onClick={() => setCommandPaletteOpen(true)}>
                  <Command className="h-3.5 w-3.5" />
                  <kbd className="text-[10px] font-mono text-muted-foreground/50 hidden xl:inline ml-1">⌘K</kbd>
                </Button>
                <Button variant="ghost" size="sm" className="h-8 min-h-[44px] sm:min-h-0 text-[13px] text-muted-foreground px-2" onClick={toggleStar} aria-label={starred ? 'Unstar' : 'Star'}>
                  <Star className={cn('h-3.5 w-3.5', starred ? 'fill-amber-400 text-amber-400' : '')} />
                </Button>
                {/* ⋯ More menu */}
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 min-h-[44px] sm:min-h-0 text-[13px] text-muted-foreground px-2"
                    onClick={() => setShowMoreMenu(prev => !prev)}
                    aria-label="More options"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                  {showMoreMenu && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setShowMoreMenu(false)} />
                      <div className="absolute right-0 top-full mt-1 z-30 bg-popover border border-border rounded-lg shadow-lg overflow-hidden min-w-[180px] py-1">
                        <button
                          onClick={() => { router.push(`/skills/${skill.slug}/versions`); setShowMoreMenu(false) }}
                          className="flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-muted w-full text-left text-foreground min-h-[44px] sm:min-h-[36px]"
                        >
                          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                          View Versions
                        </button>
                        <button
                          onClick={() => { navigator.clipboard.writeText(window.location.href); setShowMoreMenu(false) }}
                          className="flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-muted w-full text-left text-foreground min-h-[44px] sm:min-h-[36px]"
                        >
                          <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                          Copy Link
                        </button>
                        <button
                          onClick={() => { handleExport(); setShowMoreMenu(false) }}
                          className="flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-muted w-full text-left text-foreground min-h-[44px] sm:min-h-[36px]"
                        >
                          <Download className="h-3.5 w-3.5 text-muted-foreground" />
                          Export Markdown
                        </button>
                        <div className="border-t border-border/60 my-1" />
                        <button
                          onClick={() => { setShowDeleteConfirm(true); setShowMoreMenu(false) }}
                          className="flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-destructive/10 w-full text-left text-destructive min-h-[44px] sm:min-h-[36px]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete Skill
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Hero content */}
            <div className="px-4 sm:px-10 lg:px-14 pt-8 sm:pt-10 pb-6 sm:pb-8">
              {/* Title row */}
              <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/40 font-medium mb-1.5">Name</p>
              <div className="flex items-start justify-between gap-4 mb-4">
                <h1 className="text-2xl sm:text-3xl font-bold font-mono text-foreground tracking-tight leading-tight">
                  {titleValue}
                </h1>
                {editorDirty && <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0 mt-2.5" title="Unsaved changes" />}
              </div>

              {/* Description — prominent */}
              {descriptionValue && (
                <div className="mb-5">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/40 font-medium mb-1.5">Description</p>
                  <p className="text-[15px] sm:text-base text-muted-foreground leading-relaxed max-w-2xl">
                    {descriptionValue}
                  </p>
                </div>
              )}

              {/* Meta pills row */}
              <div className="flex flex-wrap items-center gap-2 mb-5">
                {skill.created_by && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-full">
                    <User className="h-3 w-3" />
                    {skill.created_by}
                  </span>
                )}
                {skill.current_version > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-full">
                    <GitBranch className="h-3 w-3" />
                    v{skill.current_version}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-full">
                  <Clock className="h-3 w-3" />
                  {formatRelative(skill.updated_at)}
                </span>
                {skill.collections.map(c => (
                  <span key={c} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-full">
                    <FolderOpen className="h-3 w-3" />
                    {c}
                  </span>
                ))}
              </div>

              {/* Tags */}
              {tagsValue.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mb-6">
                  <Tag className="h-3 w-3 text-muted-foreground/40 mr-0.5" />
                  {tagsValue.map(tag => (
                    <span key={tag} className="text-[11px] font-mono text-accent/80 bg-accent/8 border border-accent/15 px-2 py-0.5 rounded-md">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <Button size="sm" className="h-9 min-h-[44px] sm:min-h-0 gap-2 text-[13px] bg-foreground text-background hover:bg-foreground/90" onClick={() => setActiveTab('edit')}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit Skill
                </Button>
                <Button variant="outline" size="sm" className="h-9 min-h-[44px] sm:min-h-0 gap-2 text-[13px]" onClick={() => router.push(`/skills/${skill.slug}/versions`)}>
                  <GitBranch className="h-3.5 w-3.5" />
                  Versions
                </Button>
                <Button variant="outline" size="sm" className="h-9 min-h-[44px] sm:min-h-0 gap-2 text-[13px] hidden sm:flex" onClick={handleExport}>
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
              </div>
            </div>

            <hr className="border-border/40 mx-0" />
          </div>

          {/* Command Palette */}
          {commandPaletteOpen && (() => {
            const actions: PaletteAction[] = [
              { icon: Pencil, label: 'Edit skill', shortcut: 'E', group: 'Actions', action: () => { setActiveTab('edit'); setCommandPaletteOpen(false) } },
              { icon: GitBranch, label: 'View versions', shortcut: '', group: 'Actions', action: () => { router.push(`/skills/${skill.slug}/versions`); setCommandPaletteOpen(false) } },
              { icon: Download, label: 'Export as Markdown', shortcut: '⌘E', group: 'Actions', action: () => { handleExport(); setCommandPaletteOpen(false) } },
              { icon: Link2, label: 'Copy link', shortcut: '⌘L', group: 'Actions', action: () => { navigator.clipboard.writeText(window.location.href); setCommandPaletteOpen(false) } },
              { icon: Star, label: starred ? 'Unstar skill' : 'Star skill', shortcut: '', group: 'Actions', action: () => { toggleStar(); setCommandPaletteOpen(false) } },
              { icon: Share2, label: 'Share', shortcut: '', group: 'Actions', action: () => { navigator.clipboard.writeText(window.location.href); setCommandPaletteOpen(false) } },
              { icon: BookOpen, label: 'Skills', shortcut: '', group: 'Navigate', action: () => { router.push('/'); setCommandPaletteOpen(false) } },
              { icon: FolderOpen, label: 'Collections', shortcut: '', group: 'Navigate', action: () => { router.push('/collections'); setCommandPaletteOpen(false) } },
              { icon: Hash, label: 'Tags', shortcut: '', group: 'Navigate', action: () => { router.push('/tags'); setCommandPaletteOpen(false) } },
              ...allSkills.map(s => ({
                icon: FileText, label: s.title, shortcut: '', group: 'Skills',
                action: () => { router.push(`/skills/${s.slug}`); setCommandPaletteOpen(false) },
              })),
            ]
            return <CommandPalette actions={actions} onClose={() => setCommandPaletteOpen(false)} />
          })()}

          {/* Content — no tab bar; edit is fullscreen overlay, comments inline in view */}
          <div className="flex-1 flex flex-col min-h-0">
            {activeTab !== 'edit' && (
              <SkillViewTab skill={skill} onAddComment={handleAddComment} />
            )}
            {activeTab === 'edit' && (
              <SkillEditTab
                editorContent={editorContent}
                setEditorContent={setEditorContent}
                editorDirty={editorDirty}
                onDiscard={handleDiscard}
                onSave={handleSave}
                onCancel={handleCancel}
                skillTitle={titleValue}
                setSkillTitle={setTitleValue}
                skillDescription={descriptionValue}
                setSkillDescription={setDescriptionValue}
                skillSlug={skill.slug}
                skillTags={tagsValue}
                setSkillTags={setTagsValue}
                openFullscreen={true}
                currentVersion={skill.current_version}
              />
            )}
          </div>
        </main>

      </div>

      {/* Keyboard shortcut footer hint — hidden on mobile/tablet (touch devices) */}
      <div className="px-4 sm:px-6 py-2 border-t border-border/60 bg-muted/30 hidden lg:flex items-center gap-2 sm:gap-4 text-[11px] text-muted-foreground shrink-0 overflow-x-auto scrollbar-hide">
        <span className="flex items-center gap-1"><Keyboard className="h-3 w-3" /> Shortcuts:</span>
        <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">E</kbd> Edit</span>
        <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">⌘K</kbd> Commands</span>
        <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">⌘S</kbd> Save</span>
        <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">Esc</kbd> Back</span>
        <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">?</kbd> Help</span>
      </div>

      {/* Save toast */}
      {saveToast && (
        <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-accent text-white text-sm font-medium rounded-lg shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          {saveToast === 'saving' ? (
            <>
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              Saved as v{savedVersion ?? skill.current_version}
            </>
          )}
        </div>
      )}

      {/* Delete confirm dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowDeleteConfirm(false)}>
          <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">Delete &ldquo;{skill.title}&rdquo;?</h3>
            <p className="text-[13px] text-muted-foreground mb-5">This will permanently delete the skill. This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="h-8 text-[13px]" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" className="h-8 text-[13px]" onClick={handleDelete}>Delete</Button>
            </div>
          </div>
        </div>
      )}

      {/* Discard confirm dialog */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowDiscardConfirm(false)}>
          <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground mb-2">Discard changes?</h3>
            <p className="text-[13px] text-muted-foreground mb-5">All unsaved changes will be lost. This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="h-8 min-h-[44px] sm:min-h-0 text-[13px]" onClick={() => setShowDiscardConfirm(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" className="h-8 min-h-[44px] sm:min-h-0 text-[13px]" onClick={confirmDiscard}>Discard</Button>
            </div>
          </div>
        </div>
      )}
      {/* Keyboard help panel */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowHelp(false)}>
          <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Keyboard className="h-4 w-4 text-muted-foreground" />
                Keyboard Shortcuts
              </h3>
              <button onClick={() => setShowHelp(false)} className="text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Close help"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2.5">
              {[
                { keys: 'E', desc: 'Open fullscreen editor' },
                { keys: 'Esc', desc: 'Go back to home / close modal' },
                { keys: '⌘K', desc: 'Open command palette' },
                { keys: '⌘S', desc: 'Save changes' },
                { keys: '?', desc: 'Toggle this help panel' },
                { keys: 'Ctrl+Enter', desc: 'Submit comment' },
              ].map(({ keys, desc }) => (
                <div key={keys} className="flex items-center justify-between">
                  <span className="text-[13px] text-foreground/80">{desc}</span>
                  <kbd className="text-[11px] font-mono text-muted-foreground bg-muted px-2 py-1 rounded">{keys}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
