'use client'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, RefreshCw, Search } from 'lucide-react'

import { inspectSource, type InspectResponse } from '@/lib/api/imports'
import { parseMarketplaceInput } from '@/lib/parse-marketplace-input'
import { SkillNoteApiError } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { ImportWorkspace } from '@/components/browse/ImportWorkspace'

type Stage = 'idle' | 'inspecting' | 'preview' | 'error'

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
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      setStage('preview')
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

  // When we have a preview, take over the whole page with the full-height
  // workspace — NOT a cramped inline split. Small screens get a scroll.
  if (stage === 'preview' && preview) {
    return (
      <ImportWorkspace
        preview={preview}
        input={input.trim()}
        onBack={reset}
        onImported={() => {
          reset()
          onImported()
        }}
      />
    )
  }

  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h2 className="text-sm font-semibold">Import skills from a repository</h2>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          Paste a GitHub shorthand (<code className="font-mono">owner/repo</code>), full URL, or
          a tree URL to a subfolder. SkillNote will clone, scan SKILL.md files, and preview them
          before anything lands in your library.
        </p>
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
              disabled={stage === 'inspecting'}
              autoFocus
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

      {stage === 'inspecting' && (
        <div className="border-t border-border/60 px-5 py-4">
          <SkeletonPreview />
        </div>
      )}
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
