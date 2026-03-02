'use client'
import { useState, useEffect, useRef } from 'react'
import { FolderOpen, Plus, X, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

type Props = { onClose: () => void; onCreated: (name: string, description: string) => void }

export function NewCollectionModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  // Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleCreate() {
    if (!name.trim()) { setNameError('Name is required'); nameRef.current?.focus(); return }
    setNameError('')
    setSaving(true)
    try {
      const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
      meta[name.trim()] = { description: description.trim(), created_at: new Date().toISOString() }
      localStorage.setItem('skillnote:collections-meta', JSON.stringify(meta))
      onCreated(name.trim(), description.trim())
      toast.success(`Collection "${name.trim()}" created`)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-150" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl overflow-hidden mx-4 animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <h3 className="text-sm font-semibold flex items-center gap-2">
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
              ref={nameRef}
              autoFocus
              value={name}
              onChange={e => { setName(e.target.value); if (nameError) setNameError('') }}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. Frontend, AI Tools, Utilities"
              className={`w-full h-9 px-3 text-[13px] bg-muted/60 border rounded-lg focus:outline-none focus:ring-1 placeholder:text-muted-foreground/50 transition-colors ${
                nameError ? 'border-destructive focus:ring-destructive' : 'border-border/60 focus:ring-ring'
              }`}
            />
            {nameError && (
              <p className="mt-1 text-[11px] text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {nameError}
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
            disabled={!name.trim() || saving}
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
