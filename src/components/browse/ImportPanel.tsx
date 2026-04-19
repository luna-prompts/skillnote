'use client'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, Github, RefreshCw, X } from 'lucide-react'

import { inspectSource, type InspectResponse } from '@/lib/api/imports'
import { parseMarketplaceInput } from '@/lib/parse-marketplace-input'
import { SkillNoteApiError } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { ImportWorkspace } from '@/components/browse/ImportWorkspace'
import { cn } from '@/lib/utils'

type Stage = 'idle' | 'inspecting' | 'preview' | 'error'

const EXAMPLES = [
  'https://github.com/garrytan/gstack',
  'https://github.com/anthropics/skills',
  'https://github.com/obra/superpowers/tree/main/skills',
]

type Props = {
  onImported: () => void
  onViewLibrary: () => void
  existingCollectionSlugs: string[]
}

export function ImportPanel({ onImported, onViewLibrary, existingCollectionSlugs }: Props) {
  const [input, setInput] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [preview, setPreview] = useState<InspectResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)

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
      }, next.after)
    }
    scheduleNext()
  }

  function stopProgress() {
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current)
      progressTimerRef.current = null
    }
  }

  useEffect(() => () => stopProgress(), [])

  async function handleInspect() {
    if (!input.trim() || stage === 'inspecting') return
    setStage('inspecting')
    setError(null)
    // Keep existing preview visible during re-inspect so the screen doesn't jump blank.
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
      setStage('preview')
      // Move focus to the workspace; it appears right under the compact search.
      requestAnimationFrame(() => {
        workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch (err) {
      stopProgress()
      setProgress(0)
      setProgressLabel('')
      const msg = err instanceof SkillNoteApiError ? err.message : 'Network error'
      setError(msg)
      setStage('error')
    }
  }

  function reset() {
    stopProgress()
    setInput('')
    setPreview(null)
    setError(null)
    setProgress(0)
    setProgressLabel('')
    setStage('idle')
  }

  const inspectDisabled =
    !input.trim() || stage === 'inspecting' || !detect || (typeof detect === 'object' && 'error' in detect)

  const isCompact = stage === 'preview' && preview != null

  return (
    <div className="space-y-4">
      {/* Input bar stays mounted; in compact mode the user can paste another URL and
          re-import without losing the current workspace. */}
      <section
        className={cn(
          'overflow-hidden rounded-xl border border-border/60 bg-card transition-all',
          isCompact ? '' : 'shadow-sm',
        )}
      >
        {!isCompact && (
          <header className="border-b border-border/60 bg-gradient-to-b from-muted/30 to-muted/5 px-6 py-4">
            <div className="flex items-center gap-2">
              <Github className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-[13.5px] font-semibold">Install skills from a marketplace</h2>
            </div>
            <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-muted-foreground">
              Paste a Claude Code plugin marketplace: a GitHub shorthand like{' '}
              <code className="rounded bg-muted px-1 py-px font-mono text-[10.5px]">owner/repo</code>,
              a full URL, or a tree URL to a subfolder. SkillNote clones the repo, scans every{' '}
              <code className="rounded bg-muted px-1 py-px font-mono text-[10.5px]">SKILL.md</code>,
              and previews each skill before anything lands in your library.
            </p>
          </header>
        )}

        <div className={cn('space-y-3', isCompact ? 'px-4 py-3' : 'px-6 py-5')}>
          <div className="relative">
            <Github className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !inspectDisabled) handleInspect()
              }}
              placeholder="garrytan/gstack · https://github.com/owner/repo · /tree/main/skills"
              className={cn(
                'pl-10 text-sm shadow-sm transition-all',
                isCompact ? 'h-10' : 'h-12 text-[14px]',
              )}
              aria-label="Repository or URL"
              disabled={stage === 'inspecting'}
              autoFocus={!isCompact}
            />
            {input && stage !== 'inspecting' && (
              <button
                type="button"
                onClick={() => setInput('')}
                aria-label="Clear"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size={isCompact ? 'sm' : 'lg'}
              onClick={handleInspect}
              disabled={inspectDisabled}
              className={cn('shrink-0', isCompact ? 'h-9 px-3.5' : 'h-11 px-5')}
              variant={isCompact ? 'outline' : 'default'}
            >
              {stage === 'inspecting' ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  {isCompact ? 'Re-importing' : 'Importing'}
                </>
              ) : isCompact ? (
                <>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Re-import
                </>
              ) : (
                <>
                  Import
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
            <div className="flex min-h-[18px] min-w-0 flex-1 items-center gap-1.5 text-[11.5px] text-muted-foreground">
              {isCompact && <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />}
              <span className="truncate">{detectLabel}</span>
              {detect && typeof detect === 'object' && 'error' in detect ? (
                <span className="ml-2 text-destructive">{detect.error}</span>
              ) : null}
            </div>
          </div>

          {!isCompact && stage !== 'inspecting' && (
            <div className="space-y-1.5 pt-1">
              <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/70">
                Try one of these marketplaces
              </span>
              <ul className="space-y-1">
                {EXAMPLES.map((ex) => (
                  <li key={ex}>
                    <button
                      type="button"
                      onClick={() => setInput(ex)}
                      title={`Paste: ${ex}`}
                      className="group/ex w-full rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5 text-left transition-colors hover:border-accent/40 hover:bg-accent/5"
                    >
                      <span className="block break-all font-mono text-[11px] leading-relaxed text-muted-foreground group-hover/ex:text-foreground">
                        {ex}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {stage === 'inspecting' && (
            <div className="space-y-1.5 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{progressLabel}</span>
                <span className="tabular-nums">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
          )}

          {stage === 'error' && error && (
            <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span>{error}</span>
              <Button size="sm" variant="ghost" onClick={reset} className="h-6 text-xs">
                Dismiss
              </Button>
            </div>
          )}
        </div>

        {stage === 'inspecting' && !isCompact && (
          <div className="border-t border-border/60 px-5 py-4">
            <SkeletonPreview />
          </div>
        )}
      </section>

      {isCompact && preview && (
        <div ref={workspaceRef}>
          <ImportWorkspace
            preview={preview}
            input={input.trim()}
            existingCollectionSlugs={existingCollectionSlugs}
            onBack={reset}
            onImported={onImported}
            onAddAnother={reset}
            onViewLibrary={onViewLibrary}
          />
        </div>
      )}
    </div>
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
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  )
}
