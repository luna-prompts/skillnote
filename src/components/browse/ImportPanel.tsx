'use client'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, RefreshCw, Search, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  applyImport,
  inspectSource,
  type InspectResponse,
  type InspectSkill,
} from '@/lib/api/imports'
import { parseMarketplaceInput } from '@/lib/parse-marketplace-input'
import { SkillNoteApiError } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'

type Stage = 'idle' | 'inspecting' | 'preview' | 'error' | 'applying' | 'done'

type Props = {
  onImported: () => void
}

export function ImportPanel({ onImported }: Props) {
  const [input, setInput] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [preview, setPreview] = useState<InspectResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [targetSlug, setTargetSlug] = useState('')
  const [focused, setFocused] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const detect = parseMarketplaceInput(input.trim())
  const detectLabel = buildDetectLabel(detect)

  function startProgress(steps: { pct: number; label: string; after: number }[]) {
    stopProgress()
    setProgress(steps[0].pct)
    setProgressLabel(steps[0].label)
    let i = 0
    const scheduleNext = () => {
      if (i >= steps.length - 1) return
      const next = steps[i + 1]
      progressTimerRef.current = setTimeout(() => {
        i++
        setProgress(next.pct)
        setProgressLabel(next.label)
        scheduleNext()
      }, next.after) as unknown as ReturnType<typeof setInterval>
    }
    scheduleNext()
  }

  function stopProgress() {
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current as unknown as number)
      progressTimerRef.current = null
    }
  }

  useEffect(() => () => stopProgress(), [])

  async function handleInspect() {
    if (!input.trim() || stage === 'inspecting' || stage === 'applying') return
    setStage('inspecting')
    setError(null)
    setPreview(null)
    startProgress([
      { pct: 15, label: 'Resolving repository…', after: 0 },
      { pct: 40, label: 'Cloning (shallow)…', after: 900 },
      { pct: 70, label: 'Scanning SKILL.md files…', after: 2400 },
      { pct: 88, label: 'Validating frontmatter…', after: 4200 },
    ])
    try {
      const data = await inspectSource({ input: input.trim() })
      stopProgress()
      setProgress(100)
      setProgressLabel('Ready')
      setPreview(data)
      setSelection(new Set(data.skills.map((s) => s.name)))
      if (data.suggested_collection_slug) setTargetSlug(data.suggested_collection_slug)
      if (data.skills.length > 0) setFocused(data.skills[0].name)
      setStage('preview')
      setTimeout(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    } catch (err) {
      stopProgress()
      setProgress(0)
      setProgressLabel('')
      const msg = err instanceof SkillNoteApiError ? err.message : 'Network error'
      setError(msg)
      setStage('error')
    }
  }

  async function handleImport() {
    if (stage !== 'preview' || !preview) return
    setStage('applying')
    setError(null)
    startProgress([
      { pct: 30, label: 'Creating source record…', after: 0 },
      { pct: 60, label: 'Writing skills to database…', after: 700 },
      { pct: 85, label: 'Finalizing…', after: 1600 },
    ])
    try {
      const r = await applyImport({
        input: input.trim(),
        target_collection_slug: targetSlug,
        skill_selection: [...selection],
        on_conflict: 'rename',
      })
      stopProgress()
      setProgress(100)
      setProgressLabel('Imported')
      const renamedCount = r.imported.filter((s) => s.renamed_reason).length
      toast.success(
        `Imported ${r.imported.length} skill${r.imported.length === 1 ? '' : 's'} into ${r.collection_slug}${renamedCount ? ` · ${renamedCount} renamed` : ''}`,
      )
      onImported()
      setStage('done')
      setTimeout(reset, 1200)
    } catch (err) {
      stopProgress()
      const msg = err instanceof Error ? err.message : 'Import failed'
      setError(msg)
      setStage('error')
    }
  }

  function reset() {
    stopProgress()
    setInput('')
    setPreview(null)
    setError(null)
    setSelection(new Set())
    setTargetSlug('')
    setFocused(null)
    setProgress(0)
    setProgressLabel('')
    setStage('idle')
  }

  const skills = preview?.skills ?? []
  const focusedSkill = skills.find((s) => s.name === focused) ?? null
  const allSelected = skills.length > 0 && selection.size === skills.length
  const toggleAll = () => setSelection(allSelected ? new Set() : new Set(skills.map((s) => s.name)))
  const toggle = (name: string) => {
    const next = new Set(selection)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelection(next)
  }

  const inspectDisabled =
    !input.trim() || stage === 'inspecting' || stage === 'applying' || !detect

  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <header className="flex items-center justify-between border-b border-border/60 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold">Import skills from a repository</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Paste a GitHub shorthand, full URL, or tree URL pointing to a skills folder.
          </p>
        </div>
        {stage !== 'idle' && (
          <Button size="sm" variant="ghost" onClick={reset} className="text-xs">
            <X className="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </header>

      <div className="space-y-3 px-5 py-4">
        <div className="flex items-stretch gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !inspectDisabled) handleInspect()
              }}
              placeholder="wshobson/agents · https://github.com/owner/repo · /tree/main/skills"
              className="h-11 pl-9 text-sm"
              aria-label="Repository or URL"
              disabled={stage === 'inspecting' || stage === 'applying'}
            />
          </div>
          <Button
            size="lg"
            onClick={handleInspect}
            disabled={inspectDisabled}
            className="h-11 px-5"
          >
            {stage === 'inspecting' ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Inspecting
              </>
            ) : (
              <>
                Inspect
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>

        <div className="flex min-h-[18px] items-center justify-between text-[11px] text-muted-foreground">
          <span>{detectLabel}</span>
          {detect && typeof detect === 'object' && 'error' in detect ? (
            <span className="text-destructive">{detect.error}</span>
          ) : null}
        </div>

        {(stage === 'inspecting' || stage === 'applying') && (
          <div className="space-y-1.5 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{progressLabel}</span>
              <span className="tabular-nums">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}

        {stage === 'error' && error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>

      {stage === 'inspecting' && (
        <div className="border-t border-border/60 px-5 py-4">
          <SkeletonPreview />
        </div>
      )}

      {stage === 'preview' || stage === 'applying' || stage === 'done' ? (
        <div ref={previewRef} className="border-t border-border/60">
          {preview && (
            <PreviewGrid
              preview={preview}
              skills={skills}
              selection={selection}
              focused={focused}
              onFocus={setFocused}
              onToggle={toggle}
              allSelected={allSelected}
              toggleAll={toggleAll}
              targetSlug={targetSlug}
              setTargetSlug={setTargetSlug}
              focusedSkill={focusedSkill}
              onImport={handleImport}
              onCancel={reset}
              stage={stage}
            />
          )}
        </div>
      ) : null}
    </section>
  )
}

function buildDetectLabel(detect: ReturnType<typeof parseMarketplaceInput>) {
  if (!detect) return '\u00a0'
  if ('error' in detect) return ''
  if (detect.source_type === 'github') {
    return `Detected: github · ${detect.repo}${'ref' in detect && detect.ref ? ` · ${detect.ref}` : ''}`
  }
  if (detect.source_type === 'git') {
    return `Detected: git · ${detect.url}`
  }
  if (detect.source_type === 'url') {
    return `Detected: url · ${detect.url}`
  }
  return '\u00a0'
}

function SkeletonPreview() {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(280px,360px)_1fr]">
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-10/12" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  )
}

function PreviewGrid({
  preview,
  skills,
  selection,
  focused,
  onFocus,
  onToggle,
  allSelected,
  toggleAll,
  targetSlug,
  setTargetSlug,
  focusedSkill,
  onImport,
  onCancel,
  stage,
}: {
  preview: InspectResponse
  skills: InspectSkill[]
  selection: Set<string>
  focused: string | null
  onFocus: (name: string) => void
  onToggle: (name: string) => void
  allSelected: boolean
  toggleAll: () => void
  targetSlug: string
  setTargetSlug: (s: string) => void
  focusedSkill: InspectSkill | null
  onImport: () => void
  onCancel: () => void
  stage: Stage
}) {
  const source = preview.source
  const disabled = stage === 'applying' || stage === 'done'

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
        <span className="font-medium text-foreground">
          {source.host}/{source.owner}/{source.repo}
        </span>
        <span>· ref {source.ref ?? 'main'}</span>
        {source.resolved_sha && (
          <span>
            · <code className="font-mono">{source.resolved_sha.slice(0, 7)}</code>
          </span>
        )}
        {source.subpath && (
          <span>
            · <code className="font-mono">{source.subpath}</code>
          </span>
        )}
        <span>· {skills.length} skill{skills.length === 1 ? '' : 's'} found</span>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(280px,360px)_1fr]">
        <div className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border/40">
          <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-2.5 py-1.5 text-[11px]">
            <label className="flex cursor-pointer items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                disabled={disabled || skills.length === 0}
                aria-label="Select all"
              />
              {selection.size} / {skills.length} selected
            </label>
            <span className="text-muted-foreground">click to preview</span>
          </div>
          <div className="max-h-[420px] overflow-auto">
            {skills.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                No SKILL.md files detected. Source will still be tracked.
              </div>
            ) : (
              skills.map((s) => {
                const isFocused = focused === s.name
                return (
                  <div
                    key={s.name}
                    role="button"
                    tabIndex={0}
                    onClick={() => onFocus(s.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onFocus(s.name)
                      }
                    }}
                    className={`flex min-w-0 cursor-pointer items-start gap-2 border-b border-border/20 px-2.5 py-2 last:border-b-0 ${
                      isFocused ? 'bg-accent/15' : 'hover:bg-muted/40'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selection.has(s.name)}
                      onChange={() => onToggle(s.name)}
                      onClick={(e) => e.stopPropagation()}
                      disabled={disabled}
                      className="mt-0.5"
                      aria-label={`Select ${s.name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{s.name}</div>
                      {s.description && (
                        <div className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground">
                          {s.description}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border/40">
          <div className="border-b border-border/40 bg-muted/20 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            Preview
          </div>
          <div className="max-h-[420px] overflow-auto p-4">
            {focusedSkill ? (
              <BodyPreview skill={focusedSkill} />
            ) : (
              <div className="py-12 text-center text-xs text-muted-foreground">
                Click a skill on the left to preview its SKILL.md.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-3 border-t border-border/40 pt-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-1">
          <label className="block text-[11px] font-medium text-muted-foreground">
            Import into collection
          </label>
          <Input
            value={targetSlug}
            onChange={(e) => setTargetSlug(e.target.value)}
            placeholder="my-collection"
            className="h-9 w-full md:w-[280px] font-mono text-[12.5px]"
            disabled={disabled}
          />
          <p className="text-[10.5px] text-muted-foreground">
            Will be auto-created if it doesn&apos;t exist. You can move skills later.
          </p>
        </div>
        <div className="flex items-center gap-2 md:self-end">
          <Button variant="ghost" onClick={onCancel} disabled={stage === 'applying'}>
            Cancel
          </Button>
          <Button
            onClick={onImport}
            disabled={stage !== 'preview' || (skills.length > 0 && selection.size === 0)}
            className="min-w-[180px]"
          >
            {stage === 'applying'
              ? 'Importing…'
              : skills.length === 0
                ? 'Track source'
                : `Import ${selection.size} skill${selection.size === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </div>
  )
}

function BodyPreview({ skill }: { skill: InspectSkill }) {
  return (
    <div className="space-y-3">
      <header>
        <h4 className="text-sm font-semibold">{skill.name}</h4>
        {skill.path && (
          <p className="mt-0.5 text-[11px] font-mono text-muted-foreground">{skill.path}</p>
        )}
      </header>
      {skill.description && (
        <div className="rounded-md border border-border/40 bg-muted/20 p-3 text-[12.5px]">
          {skill.description}
        </div>
      )}
      <div className="space-y-0.5 text-[11px] text-muted-foreground">
        {skill.license && <div>License: {skill.license}</div>}
        {skill.content_hash && (
          <div>
            SHA: <code className="font-mono">{skill.content_hash.slice(0, 12)}</code>
          </div>
        )}
      </div>
      {skill.body ? (
        <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-md border border-border/40 bg-background p-3 font-mono text-[11.5px] leading-relaxed">
          {skill.body}
        </pre>
      ) : (
        <div className="rounded-md border border-dashed border-border/40 p-3 text-[11px] text-muted-foreground">
          No body returned. The full file will still be imported.
        </div>
      )}
    </div>
  )
}
