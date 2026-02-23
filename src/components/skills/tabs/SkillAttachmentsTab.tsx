'use client'
import { useState } from 'react'
import { ChevronDown, ChevronRight, Download, FileUp, File, FileText, Image, Paperclip, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { type Attachment } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

function getFileIcon(type: string) {
  if (type.startsWith('image/')) return Image
  if (type.includes('pdf') || type.includes('document')) return FileText
  return File
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function getFileCategory(type: string): string {
  if (type.startsWith('image/')) return 'Images'
  if (type.includes('pdf') || type.includes('document')) return 'Documents'
  return 'Other'
}

function AttachmentsList({ attachments }: { attachments: Attachment[] }) {
  const [selectAll, setSelectAll] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const grouped = attachments.reduce<Record<string, Attachment[]>>((acc, a) => {
    const cat = getFileCategory(a.type)
    ;(acc[cat] ??= []).push(a)
    return acc
  }, {})

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelected(new Set())
    } else {
      setSelected(new Set(attachments.map(a => a.id)))
    }
    setSelectAll(!selectAll)
  }

  const toggleCollapse = (cat: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <label className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={selectAll}
            onChange={toggleSelectAll}
            className="rounded border-border accent-accent"
          />
          Select all ({attachments.length} files)
        </label>
        {selected.size > 0 && (
          <Button variant="outline" size="sm" className="h-7 text-[12px] gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10">
            <Trash2 className="h-3 w-3" />
            Delete ({selected.size})
          </Button>
        )}
      </div>
      <div className="space-y-4">
        {Object.entries(grouped).map(([category, files]) => (
          <div key={category}>
            <button
              onClick={() => toggleCollapse(category)}
              className="flex items-center gap-2 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
            >
              {collapsed.has(category) ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {category} ({files.length})
            </button>
            {!collapsed.has(category) && (
              <div className="space-y-1">
                {files.map(file => {
                  const Icon = getFileIcon(file.type)
                  return (
                    <div
                      key={file.id}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-card hover:bg-muted/30 transition-colors',
                        selected.has(file.id) && 'bg-accent/5 border-accent/30'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(file.id)}
                        onChange={() => toggleSelect(file.id)}
                        className="rounded border-border accent-accent shrink-0"
                      />
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-foreground truncate">{file.filename}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatFileSize(file.size)} · {file.uploader && `${file.uploader} · `}{new Date(file.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0" aria-label="Download">
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

type SkillAttachmentsTabProps = {
  attachments: Attachment[]
}

export function SkillAttachmentsTab({ attachments }: SkillAttachmentsTabProps) {
  return (
    <div className="flex-1 p-6 mt-0 overflow-auto animate-in fade-in duration-200">
      <div className="max-w-2xl">
        <div className="border-2 border-dashed border-border/60 rounded-xl p-6 text-center bg-muted/20 hover:bg-muted/40 hover:border-accent/40 transition-colors cursor-pointer group mb-6">
          <div className="flex items-center justify-center gap-3">
            <FileUp className="h-5 w-5 text-muted-foreground/60 group-hover:text-accent transition-colors" />
            <div className="text-left">
              <p className="text-[13px] font-medium text-foreground">Drop files here or click to browse</p>
              <p className="text-[11px] text-muted-foreground">Images, PDFs, code files, archives up to 10MB</p>
            </div>
          </div>
        </div>

        {attachments.length > 0 ? (
          <AttachmentsList attachments={attachments} />
        ) : (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-10 h-10 rounded-xl bg-muted/80 flex items-center justify-center mb-3">
              <Paperclip className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="text-[13px] font-medium text-foreground mb-0.5">No attachments</p>
            <p className="text-[12px] text-muted-foreground">Upload files to attach them to this skill.</p>
          </div>
        )}
      </div>
    </div>
  )
}
