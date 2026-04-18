'use client'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { inspectSource, type InspectResponse, applyImport } from '@/lib/api/imports'
import { parseMarketplaceInput } from '@/lib/parse-marketplace-input'
import { toast } from 'sonner'
import { SkillNoteApiError } from '@/lib/api/client'

type State =
  | { kind: 'idle' }
  | { kind: 'inspecting' }
  | { kind: 'preview'; data: InspectResponse }
  | { kind: 'inspect_failed'; message: string }
  | { kind: 'applying' }
  | { kind: 'success' }

export function ImportSheet({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [input, setInput] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [targetSlug, setTargetSlug] = useState<string>('')

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
      })
      toast.success(`✓ Imported ${r.imported.length} skills from ${state.data.source.owner}/${state.data.source.repo}`)
      setState({ kind: 'success' })
      onImported()
      setTimeout(onClose, 500)
    } catch (err) {
      setState({ kind: 'inspect_failed', message: err instanceof Error ? err.message : 'Apply failed' })
    }
  }

  const selectAll = () => state.kind === 'preview' && setSelection(new Set(state.data.skills.map(s => s.name)))
  const deselectAll = () => setSelection(new Set())
  const toggle = (name: string) => {
    const next = new Set(selection)
    if (next.has(name)) next.delete(name); else next.add(name)
    setSelection(next)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose}>
      <div className="absolute right-0 top-0 flex h-full w-[min(900px,90vw)] flex-col bg-card shadow-2xl"
           onClick={e => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <h3 className="font-semibold">Import skills from a repository</h3>
          <button onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex-1 overflow-auto p-6 space-y-4">
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
              ✓ Detected: {detect.source_type}{'repo' in detect ? ` · ${detect.repo}` : ''}{'ref' in detect && detect.ref ? ` · ${detect.ref}` : ''}
            </div>
          )}

          {state.kind === 'inspecting' && <div className="text-sm text-muted-foreground">Inspecting…</div>}
          {state.kind === 'inspect_failed' && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {state.message}
            </div>
          )}
          {state.kind === 'preview' && (
            <div className="space-y-3">
              <div className="rounded-md border border-border/50 bg-muted/30 p-3 text-sm">
                {state.data.source.host}/{state.data.source.owner}/{state.data.source.repo} ·
                {' '}{state.data.source.ref ?? 'main'} · {state.data.skills.length} skills
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Import into</label>
                <input value={targetSlug} onChange={e => setTargetSlug(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-muted/50 px-3 text-sm" />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  You can move skills into other collections after import.
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span>[{selection.size} / {state.data.skills.length}]</span>
                  <div className="space-x-2">
                    <button onClick={selectAll} className="hover:underline">Select all</button>
                    <button onClick={deselectAll} className="hover:underline">Deselect all</button>
                  </div>
                </div>
                <div className="max-h-[400px] overflow-auto rounded-md border border-border/30">
                  {state.data.skills.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      No skills detected yet. The importer will still track this source; skills may appear after the upstream repo is cloned.
                    </div>
                  ) : state.data.skills.map(s => (
                    <label key={s.name} className="flex items-start gap-2 border-b border-border/20 p-2 last:border-b-0 cursor-pointer hover:bg-muted/30">
                      <input type="checkbox" checked={selection.has(s.name)} onChange={() => toggle(s.name)} className="mt-0.5" />
                      <div>
                        <div className="text-sm font-medium">{s.name}</div>
                        <div className="text-xs text-muted-foreground">{s.description?.slice(0, 80)}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-border/60 px-6 py-4">
          <button onClick={onClose}
            className="rounded-md border border-border/60 bg-card px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            onClick={doImport}
            disabled={state.kind !== 'preview' || (state.data.skills.length > 0 && selection.size === 0)}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50">
            {state.kind === 'applying' ? 'Importing…' : state.kind === 'preview' && state.data.skills.length === 0 ? 'Track source' : `Import ${selection.size} skills`}
          </button>
        </footer>
      </div>
    </div>
  )
}
