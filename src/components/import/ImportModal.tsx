'use client'

import { useState, useCallback, useRef } from 'react'
import { Upload, FileText, X, Check, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skill } from '@/lib/mock-data'
import { addSkill } from '@/lib/skills-store'
import { parseMarkdown } from '@/lib/markdown-utils'
import { toast } from 'sonner'

type ParsedFile = {
  filename: string
  skill: Omit<Skill, 'comments' | 'attachments' | 'revisions'>
}

export function ImportModal({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const [files, setFiles] = useState<ParsedFile[]>([])
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
            const name = path.split('/').pop() || path
            const skill = parseMarkdown(text, name)
            results.push({ filename: name, skill })
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

    setFiles(prev => [...prev, ...results])
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    processFiles(e.dataTransfer.files)
  }, [processFiles])

  const handleImport = useCallback(() => {
    setImporting(true)
    for (const { skill } of files) {
      addSkill(skill as Skill)
    }
    toast.success(`Imported ${files.length} skill${files.length !== 1 ? 's' : ''}`)
    onImported?.()
    onClose()
  }, [files, onClose, onImported])

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden mx-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Upload className="h-4 w-4 text-muted-foreground" />
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
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              dragging
                ? 'border-accent bg-accent/5'
                : 'border-border/60 hover:border-muted-foreground/40 hover:bg-muted/30'
            }`}
          >
            <Upload className={`h-8 w-8 mx-auto mb-3 ${dragging ? 'text-accent' : 'text-muted-foreground/40'}`} />
            <p className="text-[13px] font-medium text-foreground mb-1">
              Drop .md or .zip files here
            </p>
            <p className="text-[12px] text-muted-foreground">
              or <span className="text-accent underline">click to browse</span>
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
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
              {files.length} file{files.length !== 1 ? 's' : ''} ready
            </p>
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg bg-muted/40">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">{f.skill.title}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {f.filename} · {f.skill.tags.length > 0 ? f.skill.tags.join(', ') : 'no tags'}
                    </p>
                  </div>
                  <button onClick={() => removeFile(i)} className="p-1 text-muted-foreground hover:text-foreground shrink-0" aria-label="Remove">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/60 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="h-8 text-[13px]" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 text-[13px] gap-1.5 bg-foreground text-background hover:bg-foreground/90"
            disabled={files.length === 0 || importing}
            onClick={handleImport}
          >
            {importing ? (
              <>
                <div className="h-3.5 w-3.5 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Import {files.length > 0 ? `${files.length} skill${files.length !== 1 ? 's' : ''}` : ''}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
