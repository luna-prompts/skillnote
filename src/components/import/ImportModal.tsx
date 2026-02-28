'use client'

import { useState, useCallback, useRef, useMemo } from 'react'
import { Upload, FileText, X, Check, Plus, Tag, FolderOpen, AlertCircle, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skill } from '@/lib/mock-data'
import { getSkills } from '@/lib/skills-store'
import { parseMarkdown } from '@/lib/markdown-utils'
import { validateSkillName, normalizeSkillName } from '@/lib/skill-validation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'

type ParsedFile = {
  filename: string
  skill: Omit<Skill, 'comments' | 'attachments' | 'revisions'>
}

function TagInput({ values, onChange, suggestions, placeholder, icon: Icon }: {
  values: string[]
  onChange: (v: string[]) => void
  suggestions: string[]
  placeholder: string
  icon: typeof Tag
}) {
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)

  const filtered = useMemo(() => {
    if (!input) return suggestions.filter(s => !values.includes(s)).slice(0, 5)
    const q = input.toLowerCase()
    return suggestions.filter(s => s.toLowerCase().includes(q) && !values.includes(s)).slice(0, 5)
  }, [input, suggestions, values])

  const addValue = (v: string) => {
    const trimmed = v.trim().toLowerCase()
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed])
    }
    setInput('')
  }

  const showDropdown = focused && (filtered.length > 0 || (input.length > 0 && !values.includes(input.trim().toLowerCase())))

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 flex-wrap min-h-[32px] px-2.5 py-1 rounded-lg border border-border/50 bg-foreground/[0.02] focus-within:border-accent/30 focus-within:ring-1 focus-within:ring-accent/20 transition-all">
        <Icon className="h-3 w-3 text-muted-foreground/30 shrink-0" />
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-0.5 pl-1.5 pr-1 py-0.5 rounded-md bg-accent/8 text-accent text-[10px] font-medium">
            {v}
            <button onClick={() => onChange(values.filter(x => x !== v))} className="hover:text-accent/70">
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={e => {
            if (e.key === 'Enter' && input.trim()) { e.preventDefault(); addValue(input) }
            if (e.key === 'Backspace' && !input && values.length) onChange(values.slice(0, -1))
          }}
          placeholder={values.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[60px] text-[11px] bg-transparent outline-none placeholder:text-muted-foreground/25 text-foreground"
        />
      </div>
      {showDropdown && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-card border border-border/50 rounded-lg shadow-lg z-20 py-0.5 overflow-hidden">
          {filtered.map(s => (
            <button
              key={s}
              onMouseDown={e => { e.preventDefault(); addValue(s) }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              {s}
            </button>
          ))}
          {input.trim() && !filtered.includes(input.trim().toLowerCase()) && !values.includes(input.trim().toLowerCase()) && (
            <button
              onMouseDown={e => { e.preventDefault(); addValue(input) }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-accent hover:bg-accent/5 transition-colors flex items-center gap-1.5"
            >
              <Plus className="h-2.5 w-2.5" />
              Create &quot;{input.trim()}&quot;
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function ImportModal({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const [files, setFiles] = useState<ParsedFile[]>([])
  const [dragging, setDragging] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Gather existing tags and collections for suggestions
  const existingSkills = useMemo(() => getSkills(), [])
  const tagSuggestions = useMemo(() => {
    const set = new Set<string>()
    existingSkills.forEach(s => s.tags?.forEach(t => set.add(t)))
    return Array.from(set).sort()
  }, [existingSkills])
  const collectionSuggestions = useMemo(() => {
    const set = new Set<string>()
    existingSkills.forEach(s => s.collections?.forEach(c => set.add(c)))
    return Array.from(set).sort()
  }, [existingSkills])

  const processFiles = useCallback(async (fileList: FileList | File[]) => {
    const results: ParsedFile[] = []

    for (const file of Array.from(fileList)) {
      if (file.name.endsWith('.md')) {
        const text = await file.text()
        const skill = parseMarkdown(text, file.name)
        results.push({ filename: file.name, skill })
      } else if (file.name.endsWith('.zip')) {
        try {
          const JSZip = (await import('jszip')).default
          const zip = await JSZip.loadAsync(file)
          const entries = Object.entries(zip.files)
          for (const [path, entry] of entries) {
            if (entry.dir || !path.endsWith('.md')) continue
            const text = await entry.async('text')
            const fileName = path.split('/').pop() || path
            // For SKILL.md files inside folders, use the folder name as the filename context
            const parts = path.split('/').filter(Boolean)
            const displayName = fileName.toUpperCase() === 'SKILL.MD' && parts.length >= 2
              ? parts[parts.length - 2] + '.md'
              : fileName
            const skill = parseMarkdown(text, displayName)
            results.push({ filename: displayName, skill })
          }
        } catch {
          toast.error('Failed to read ZIP file')
        }
      }
    }

    if (results.length === 0) {
      toast.error('No .md files found')
      return
    }

    setFiles(prev => {
      const updated = [...prev, ...results]
      // Auto-expand the first new file for editing
      if (results.length === 1) setEditingIdx(prev.length)
      return updated
    })
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    processFiles(e.dataTransfer.files)
  }, [processFiles])

  /** Get name validation errors for a parsed file */
  const getNameErrors = (skill: ParsedFile['skill']) => {
    const normalized = normalizeSkillName(skill.title)
    return validateSkillName(normalized)
  }

  /** Check if any file has a duplicate name with existing skills */
  const isDuplicate = (skill: ParsedFile['skill']) => {
    const normalized = normalizeSkillName(skill.title)
    return existingSkills.some(s => s.slug === normalized)
  }

  /** Open skill in the create/edit view instead of directly creating */
  const handleReviewAndCreate = useCallback((file: ParsedFile) => {
    const normalized = normalizeSkillName(file.skill.title)
    const params = new URLSearchParams()
    params.set('name', normalized)
    if (file.skill.description) params.set('description', file.skill.description)
    if (file.skill.content_md) params.set('content', file.skill.content_md)
    if (file.skill.tags.length > 0) params.set('tags', file.skill.tags.join(','))
    if (file.skill.collections.length > 0) params.set('collections', file.skill.collections.join(','))

    onImported?.()
    onClose()
    router.push(`/skills/new?${params.toString()}`)
  }, [router, onClose, onImported])

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
    if (editingIdx === idx) setEditingIdx(null)
    else if (editingIdx !== null && editingIdx > idx) setEditingIdx(editingIdx - 1)
  }

  const updateFileTags = (idx: number, tags: string[]) => {
    setFiles(prev => prev.map((f, i) => i === idx ? { ...f, skill: { ...f.skill, tags } } : f))
  }

  const updateFileCollections = (idx: number, collections: string[]) => {
    setFiles(prev => prev.map((f, i) => i === idx ? { ...f, skill: { ...f.skill, collections } } : f))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <div className="w-full max-w-lg bg-card border border-border/50 rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden mx-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
          <h3 className="text-[13px] font-bold text-foreground flex items-center gap-2 tracking-tight">
            <Upload className="h-4 w-4 text-muted-foreground/50" />
            Import Skills
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Drop zone */}
        <div className="px-6 py-5">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200',
              dragging
                ? 'border-accent bg-accent/5 scale-[0.99]'
                : 'border-border/40 hover:border-muted-foreground/30 hover:bg-foreground/[0.01]'
            )}
          >
            <Upload className={cn('h-7 w-7 mx-auto mb-3 transition-colors', dragging ? 'text-accent' : 'text-muted-foreground/25')} />
            <p className="text-[13px] font-medium text-foreground mb-1">
              Drop .md or .zip files here
            </p>
            <p className="text-[11px] text-muted-foreground/50">
              or <span className="text-accent/70 hover:text-accent">click to browse</span>
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".md,.zip"
            multiple
            className="hidden"
            onChange={e => {
              if (e.target.files) processFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="px-6 pb-4">
            <p className="text-[10px] font-bold text-foreground/30 uppercase tracking-[0.15em] mb-2">
              {files.length} file{files.length !== 1 ? 's' : ''} ready
            </p>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {files.map((f, i) => {
                const nameErrors = getNameErrors(f.skill)
                const duplicate = isDuplicate(f.skill)
                const hasIssue = nameErrors.length > 0 || duplicate

                return (
                  <div key={i} className={cn('rounded-lg border overflow-hidden', hasIssue ? 'border-destructive/40 bg-destructive/[0.02]' : 'border-border/30 bg-foreground/[0.01]')}>
                    <div
                      className="flex items-center gap-2.5 py-2 px-3 cursor-pointer hover:bg-foreground/[0.02] transition-colors"
                      onClick={() => setEditingIdx(editingIdx === i ? null : i)}
                    >
                      <FileText className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[12px] font-semibold text-foreground truncate">{f.skill.title}</p>
                          {hasIssue && <AlertCircle className="h-3 w-3 text-destructive shrink-0" />}
                        </div>
                        <p className="text-[10px] text-muted-foreground/40 truncate">
                          {f.filename}
                          {duplicate && <span className="text-destructive ml-1">- name already exists</span>}
                          {nameErrors.length > 0 && <span className="text-destructive ml-1">- {nameErrors[0].message}</span>}
                          {!hasIssue && (f.skill.tags.length > 0 || f.skill.collections.length > 0) && (
                            <span className="text-accent/50">
                              {f.skill.tags.length > 0 && ` · ${f.skill.tags.join(', ')}`}
                              {f.skill.collections.length > 0 && ` · ${f.skill.collections.join(', ')}`}
                            </span>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); removeFile(i) }}
                        className="p-1 text-muted-foreground/30 hover:text-foreground shrink-0"
                        aria-label="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Expanded edit area for tags + collections */}
                    {editingIdx === i && (
                      <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/20">
                        {hasIssue && (
                          <div className="flex items-start gap-1.5 p-2 bg-destructive/5 border border-destructive/10 rounded-lg">
                            <AlertCircle className="h-3 w-3 text-destructive mt-0.5 shrink-0" />
                            <p className="text-[10px] text-destructive leading-relaxed">
                              {duplicate
                                ? `A skill named "${normalizeSkillName(f.skill.title)}" already exists. You can review and fix the name in the editor.`
                                : nameErrors.map(e => e.message).join('. ')
                              }
                            </p>
                          </div>
                        )}
                        <div>
                          <label className="text-[9px] font-bold text-foreground/20 uppercase tracking-[0.15em] mb-1 block">Tags</label>
                          <TagInput
                            values={f.skill.tags}
                            onChange={tags => updateFileTags(i, tags)}
                            suggestions={tagSuggestions}
                            placeholder="Add tags..."
                            icon={Tag}
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-foreground/20 uppercase tracking-[0.15em] mb-1 block">Collection</label>
                          <TagInput
                            values={f.skill.collections}
                            onChange={cols => updateFileCollections(i, cols)}
                            suggestions={collectionSuggestions}
                            placeholder="Add to collection..."
                            icon={FolderOpen}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/40 flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground/50">
            Each skill opens in editor for review before creating
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-[13px] border-border/40" onClick={onClose}>
              Cancel
            </Button>
            {files.length === 1 ? (
              <Button
                size="sm"
                className="h-8 text-[13px] gap-1.5 bg-foreground text-background hover:bg-foreground/90"
                onClick={() => handleReviewAndCreate(files[0])}
              >
                <Pencil className="h-3.5 w-3.5" />
                Review &amp; Create
              </Button>
            ) : (
              <div className="flex items-center gap-1.5">
                {files.map((f, i) => (
                  <Button
                    key={i}
                    size="sm"
                    variant="outline"
                    className="h-8 text-[12px] gap-1 max-w-[140px]"
                    onClick={() => handleReviewAndCreate(f)}
                    title={`Review "${f.skill.title}"`}
                  >
                    <Pencil className="h-3 w-3 shrink-0" />
                    <span className="truncate">{f.skill.title || `File ${i + 1}`}</span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
