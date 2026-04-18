'use client'
import { useState, useEffect } from 'react'
import { FolderOpen, Plus, X, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { createCollectionApi } from '@/lib/api/collections'
import { validateCollectionName, COLLECTION_NAME_MAX } from '@/lib/collection-validation'

type Props = { onClose: () => void; onCreated: (name: string, description: string) => void }

export function NewCollectionModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)

  const nameErrors = touched ? validateCollectionName(name) : []
  const isValid = validateCollectionName(name).length === 0

  // Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleCreate() {
    setTouched(true)
    const errs = validateCollectionName(name)
    if (errs.length > 0) return
    setSaving(true)
    try {
      const trimmedName = name.trim()
      const trimmedDesc = description.trim()
      try {
        await createCollectionApi(trimmedName, trimmedDesc)
      } catch (err) {
        // Fallback: keep local-only entry so user doesn't lose their work if offline
        try {
          const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
          meta[trimmedName] = { description: trimmedDesc, created_at: new Date().toISOString() }
          localStorage.setItem('skillnote:collections-meta', JSON.stringify(meta))
        } catch {}
        toast.error(err instanceof Error ? err.message : 'Could not create collection on server — saved locally')
        onCreated(trimmedName, trimmedDesc)
        onClose()
        return
      }
      onCreated(trimmedName, trimmedDesc)
      toast.success(`Collection "${trimmedName}" created`)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-150" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-collection-title"
        className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl overflow-hidden mx-4 animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <h3 id="new-collection-title" className="text-sm font-semibold flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            New Collection
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. Frontend, AI Tools, Utilities"
              maxLength={COLLECTION_NAME_MAX}
              className={`w-full h-9 px-3 text-[13px] bg-muted/60 border rounded-lg focus:outline-none focus:ring-1 placeholder:text-muted-foreground/50 transition-colors ${
                nameErrors.length > 0 ? 'border-destructive focus:ring-destructive' : 'border-border/60 focus:ring-ring'
              }`}
            />
            {touched && nameErrors[0] && (
              <p className="mt-1 text-[11px] text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {nameErrors[0].message}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCreate() }}
              placeholder="What kind of skills belong here?"
              rows={2}
              className="w-full px-3 py-2 text-[13px] bg-muted/60 border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 resize-none leading-relaxed"
            />
            <p className="mt-1 text-[10px] text-muted-foreground/40">⌘↵ to create</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/60 flex justify-end gap-2">
          <Button variant="outline" size="sm" className="h-8 text-[13px]" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 text-[13px] gap-1.5 bg-foreground text-background hover:bg-foreground/90"
            disabled={!name.trim() || saving || !isValid}
            onClick={handleCreate}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create
          </Button>
        </div>
      </div>
    </div>
  )
}
