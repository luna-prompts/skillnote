'use client'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { inspectSource, type InspectResponse, applyImport, type InspectSkill } from '@/lib/api/imports'
import { parseMarketplaceInput } from '@/lib/parse-marketplace-input'
import { toast } from 'sonner'
import { SkillNoteApiError } from '@/lib/api/client'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { SkillSelectionList } from './SkillSelectionList'
import { SkillPreviewPane } from './SkillPreviewPane'
import { CollectionTargetPicker } from './CollectionTargetPicker'

type State =
  | { kind: 'idle' }
  | { kind: 'inspecting' }
  | { kind: 'preview'; data: InspectResponse }
  | { kind: 'inspect_failed'; message: string }
  | { kind: 'applying' }
  | { kind: 'success' }

type Conflict = 'rename' | 'skip' | 'replace'

export function ImportSheet({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [input, setInput] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [targetSlug, setTargetSlug] = useState<string>('')
  const [focused, setFocused] = useState<string | null>(null)
  const [perSkillConflict, setPerSkillConflict] = useState<Record<string, Conflict>>({})
  const [globalConflict] = useState<Conflict>('rename')

  const detect = parseMarketplaceInput(input)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function doInspect() {
    if (!input.trim()) return
    setState({ kind: 'inspecting' })
    try {
      const data = await inspectSource({ input: input.trim() })
      setState({ kind: 'preview', data })
      setSelection(new Set(data.skills.map(s => s.name)))
      if (data.suggested_collection_slug) setTargetSlug(data.suggested_collection_slug)
      if (data.skills.length > 0) setFocused(data.skills[0].name)
    } catch (err) {
      const msg = err instanceof SkillNoteApiError ? err.message : 'Network error'
      setState({ kind: 'inspect_failed', message: msg })
    }
  }

  async function doImport() {
    if (state.kind !== 'preview') return
    setState({ kind: 'applying' })
    try {
      const r = await applyImport({
        input: input.trim(),
        target_collection_slug: targetSlug,
        skill_selection: [...selection],
        on_conflict: globalConflict,
      })
      toast.success(`Imported ${r.imported.length} skills from ${state.data.source.owner}/${state.data.source.repo}`)
      setState({ kind: 'success' })
      onImported()
      setTimeout(onClose, 500)
    } catch (err) {
      setState({ kind: 'inspect_failed', message: err instanceof Error ? err.message : 'Apply failed' })
    }
  }

  const skills: InspectSkill[] = state.kind === 'preview' ? state.data.skills : []
  const focusedSkill = skills.find(s => s.name === focused) ?? null

  const selectAll = () => setSelection(new Set(skills.map(s => s.name)))
  const deselectAll = () => setSelection(new Set())
  const toggle = (name: string) => {
    const next = new Set(selection)
    if (next.has(name)) next.delete(name); else next.add(name)
    setSelection(next)
  }
  const onConflictChange = (name: string, c: Conflict) =>
    setPerSkillConflict(prev => ({ ...prev, [name]: c }))

  return (
    <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose}>
      <div
        className="absolute right-0 top-0 flex h-full w-[min(1100px,95vw)] flex-col bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <h3 className="font-semibold">Import skills from a repository</h3>
          <button onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </header>

        <div className="space-y-3 border-b border-border/40 px-6 py-4">
          <label className="block text-xs font-medium">Repository or URL</label>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onBlur={doInspect}
            placeholder="wshobson/agents, https://github.com/owner/repo, or https://.../marketplace.json"
            className="h-10 w-full rounded-md border border-border/60 bg-muted/50 px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
          {detect && 'source_type' in detect && (
            <div className="text-xs text-muted-foreground">
              Detected: {detect.source_type}{'repo' in detect ? ` · ${detect.repo}` : ''}{'ref' in detect && detect.ref ? ` · ${detect.ref}` : ''}
            </div>
          )}
          {state.kind === 'preview' && (
            <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-xs">
              {state.data.source.host}/{state.data.source.owner}/{state.data.source.repo} · {state.data.source.ref ?? 'main'} · {state.data.skills.length} skills
            </div>
          )}
          {state.kind === 'inspect_failed' && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {state.message}
            </div>
          )}
          {state.kind === 'preview' && (
            <CollectionTargetPicker
              value={targetSlug}
              onChange={setTargetSlug}
              suggested={state.data.suggested_collection_slug}
            />
          )}
        </div>

        {state.kind === 'inspecting' && (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Inspecting…</div>
        )}
        {state.kind === 'idle' && (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Paste a repo URL above to preview its skills.
          </div>
        )}
        {state.kind === 'inspect_failed' && (
          <div className="flex-1" />
        )}
        {(state.kind === 'preview' || state.kind === 'applying' || state.kind === 'success') && (
          <div className="flex-1 min-h-0">
            <ResizablePanelGroup orientation="horizontal">
              <ResizablePanel defaultSize={35} minSize={22} maxSize={55}>
                <SkillSelectionList
                  skills={skills}
                  selection={selection}
                  onToggle={toggle}
                  onSelectAll={selectAll}
                  onDeselectAll={deselectAll}
                  focused={focused}
                  onFocus={setFocused}
                  perSkillConflict={perSkillConflict}
                  onConflictChange={onConflictChange}
                />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={65} minSize={30}>
                <SkillPreviewPane skill={focusedSkill} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        )}

        <footer className="flex justify-end gap-2 border-t border-border/60 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md border border-border/60 bg-card px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={doImport}
            disabled={state.kind !== 'preview' || (skills.length > 0 && selection.size === 0)}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
          >
            {state.kind === 'applying' ? 'Importing…' : skills.length === 0 && state.kind === 'preview' ? 'Track source' : `Import ${selection.size} skills`}
          </button>
        </footer>
      </div>
    </div>
  )
}
