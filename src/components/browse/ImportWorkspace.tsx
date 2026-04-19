'use client'
import { useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, GitBranch, GitCommit, Loader2, Search } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'

import { applyImport, type InspectResponse, type InspectSkill } from '@/lib/api/imports'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'

type Stage = 'preview' | 'applying' | 'done'

type Props = {
  preview: InspectResponse
  input: string
  onBack: () => void
  onImported: () => void
}

export function ImportWorkspace({ preview, input, onBack, onImported }: Props) {
  const initial = new Set(preview.skills.map((s) => s.name))
  const [selection, setSelection] = useState<Set<string>>(initial)
  const [targetSlug, setTargetSlug] = useState(preview.suggested_collection_slug ?? '')
  const [focused, setFocused] = useState<string | null>(preview.skills[0]?.name ?? null)
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage>('preview')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')

  const skills = preview.skills
  const source = preview.source

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (s.path ?? '').toLowerCase().includes(q),
    )
  }, [skills, query])

  const focusedSkill = skills.find((s) => s.name === focused) ?? null

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((s) => selection.has(s.name))

  const toggle = (name: string) => {
    const next = new Set(selection)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelection(next)
  }
  const toggleAllVisible = () => {
    const next = new Set(selection)
    if (allFilteredSelected) filtered.forEach((s) => next.delete(s.name))
    else filtered.forEach((s) => next.add(s.name))
    setSelection(next)
  }
  const clearSelection = () => setSelection(new Set())
  const selectAll = () => setSelection(new Set(skills.map((s) => s.name)))

  async function handleImport() {
    if (stage !== 'preview') return
    setStage('applying')
    const stages: { pct: number; label: string; after: number }[] = [
      { pct: 25, label: 'Creating source record…', after: 0 },
      { pct: 55, label: `Writing ${selection.size} skill${selection.size === 1 ? '' : 's'}…`, after: 600 },
      { pct: 82, label: 'Finalizing collection…', after: 1500 },
    ]
    setProgress(stages[0].pct)
    setProgressLabel(stages[0].label)
    let i = 0
    const timer = setInterval(() => {
      if (i < stages.length - 1) {
        i++
        setProgress(stages[i].pct)
        setProgressLabel(stages[i].label)
      } else {
        clearInterval(timer)
      }
    }, 700)
    try {
      const r = await applyImport({
        input,
        target_collection_slug: targetSlug,
        skill_selection: [...selection],
        on_conflict: 'rename',
      })
      clearInterval(timer)
      setProgress(100)
      setProgressLabel('Done')
      const renamed = r.imported.filter((s) => s.renamed_reason).length
      toast.success(
        `Imported ${r.imported.length} skill${r.imported.length === 1 ? '' : 's'} into ${r.collection_slug}${renamed ? ` · ${renamed} renamed` : ''}`,
      )
      setStage('done')
      setTimeout(() => {
        onImported()
      }, 700)
    } catch (err) {
      clearInterval(timer)
      toast.error(err instanceof Error ? err.message : 'Import failed')
      setStage('preview')
      setProgress(0)
      setProgressLabel('')
    }
  }

  const disabled = stage === 'applying' || stage === 'done'

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[560px] flex-col overflow-hidden rounded-xl border border-border/60 bg-card">
      <Header
        source={source}
        input={input}
        selectionCount={selection.size}
        totalCount={skills.length}
        onBack={onBack}
        disabled={disabled}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[340px_1fr] lg:grid-cols-[380px_1fr]">
        <SkillsSidebar
          skills={filtered}
          totalCount={skills.length}
          selection={selection}
          focused={focused}
          onFocus={setFocused}
          onToggle={toggle}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          allFilteredSelected={allFilteredSelected}
          onToggleAllVisible={toggleAllVisible}
          query={query}
          onQueryChange={setQuery}
          disabled={disabled}
        />
        <MarkdownPane skill={focusedSkill} />
      </div>

      <Footer
        targetSlug={targetSlug}
        setTargetSlug={setTargetSlug}
        selectionCount={selection.size}
        totalCount={skills.length}
        stage={stage}
        progress={progress}
        progressLabel={progressLabel}
        onImport={handleImport}
        onCancel={onBack}
      />
    </div>
  )
}

function Header({
  source,
  input,
  selectionCount,
  totalCount,
  onBack,
  disabled,
}: {
  source: InspectResponse['source']
  input: string
  selectionCount: number
  totalCount: number
  onBack: () => void
  disabled: boolean
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={onBack}
          disabled={disabled}
          className="h-8 px-2 text-muted-foreground"
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back
        </Button>
        <div className="h-4 w-px bg-border/60" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="truncate font-semibold">
              {source.host}/{source.owner}/{source.repo}
            </span>
            {source.subpath && (
              <span className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {source.subpath}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[11.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <GitBranch className="h-3 w-3" /> {source.ref ?? 'main'}
            </span>
            {source.resolved_sha && (
              <span className="inline-flex items-center gap-1">
                <GitCommit className="h-3 w-3" />
                <code className="font-mono">{source.resolved_sha.slice(0, 7)}</code>
              </span>
            )}
            <span className="truncate font-mono opacity-70">{input}</span>
          </div>
        </div>
      </div>
      <div className="shrink-0 rounded-full border border-border/60 bg-background px-2.5 py-1 text-[11.5px] font-medium tabular-nums">
        <span className="text-foreground">{selectionCount}</span>
        <span className="text-muted-foreground"> / {totalCount} selected</span>
      </div>
    </header>
  )
}

function SkillsSidebar({
  skills,
  totalCount,
  selection,
  focused,
  onFocus,
  onToggle,
  onSelectAll,
  onClearSelection,
  allFilteredSelected,
  onToggleAllVisible,
  query,
  onQueryChange,
  disabled,
}: {
  skills: InspectSkill[]
  totalCount: number
  selection: Set<string>
  focused: string | null
  onFocus: (name: string) => void
  onToggle: (name: string) => void
  onSelectAll: () => void
  onClearSelection: () => void
  allFilteredSelected: boolean
  onToggleAllVisible: () => void
  query: string
  onQueryChange: (s: string) => void
  disabled: boolean
}) {
  return (
    <aside className="flex min-h-0 flex-col border-b border-border/50 md:border-b-0 md:border-r">
      <div className="space-y-2 border-b border-border/40 bg-muted/10 p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={`Filter ${totalCount} skill${totalCount === 1 ? '' : 's'}…`}
            className="h-8 pl-7 text-[12.5px]"
            aria-label="Filter skills"
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={onToggleAllVisible}
              disabled={disabled || skills.length === 0}
              aria-label="Select all visible"
            />
            {skills.length === totalCount
              ? `Select all (${totalCount})`
              : `Select ${skills.length} matching`}
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSelectAll}
              className="hover:underline"
              disabled={disabled}
            >
              All
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={onClearSelection}
              className="hover:underline"
              disabled={disabled}
            >
              None
            </button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {skills.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {totalCount === 0
              ? 'No SKILL.md files detected. Source will still be tracked.'
              : 'No skills match your filter.'}
          </div>
        ) : (
          skills.map((s) => {
            const isFocused = focused === s.name
            const isSelected = selection.has(s.name)
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
                className={`flex min-w-0 cursor-pointer items-start gap-2 border-b border-border/20 px-3 py-2.5 text-left last:border-b-0 ${
                  isFocused
                    ? 'bg-accent/15'
                    : 'hover:bg-muted/40'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(s.name)}
                  onClick={(e) => e.stopPropagation()}
                  disabled={disabled}
                  aria-label={`Select ${s.name}`}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium">{s.name}</span>
                  </div>
                  {s.description && (
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">
                      {s.description}
                    </p>
                  )}
                  {s.path && (
                    <p className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground/70">
                      {s.path}
                    </p>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}

function MarkdownPane({ skill }: { skill: InspectSkill | null }) {
  if (!skill) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Select a skill on the left to preview its SKILL.md.
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-col">
      <header className="border-b border-border/40 bg-muted/10 px-5 py-3">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{skill.name}</h3>
          {skill.license && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
              {skill.license}
            </span>
          )}
        </div>
        {skill.path && (
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{skill.path}</p>
        )}
        {skill.description && (
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">{skill.description}</p>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {skill.body ? (
          <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none prose-pre:text-[12px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{skill.body}</ReactMarkdown>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border/40 p-4 text-xs text-muted-foreground">
            No body returned. The full file will still be imported.
          </div>
        )}
      </div>
    </div>
  )
}

function Footer({
  targetSlug,
  setTargetSlug,
  selectionCount,
  totalCount,
  stage,
  progress,
  progressLabel,
  onImport,
  onCancel,
}: {
  targetSlug: string
  setTargetSlug: (v: string) => void
  selectionCount: number
  totalCount: number
  stage: Stage
  progress: number
  progressLabel: string
  onImport: () => void
  onCancel: () => void
}) {
  const disabled = stage === 'applying' || stage === 'done'
  const hasSkills = totalCount > 0
  const buttonLabel =
    stage === 'applying'
      ? 'Importing…'
      : stage === 'done'
        ? 'Done'
        : hasSkills
          ? `Import ${selectionCount} skill${selectionCount === 1 ? '' : 's'}`
          : 'Track source'

  return (
    <footer className="border-t border-border/60 bg-muted/10 px-4 py-3">
      {stage !== 'preview' && (
        <div className="mb-2.5 flex items-center gap-3">
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{progressLabel}</span>
              <span className="tabular-nums">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-1" />
          </div>
        </div>
      )}
      <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <label className="shrink-0 text-[11.5px] font-medium text-muted-foreground">
            Import into
          </label>
          <Input
            value={targetSlug}
            onChange={(e) => setTargetSlug(e.target.value)}
            placeholder="my-collection"
            className="h-8 w-full font-mono text-[12.5px] md:w-[260px]"
            disabled={disabled}
          />
        </div>
        <div className="flex items-center gap-2 md:self-end">
          <Button variant="ghost" onClick={onCancel} disabled={stage === 'applying'}>
            Cancel
          </Button>
          <Button
            onClick={onImport}
            disabled={disabled || (hasSkills && selectionCount === 0)}
            className="min-w-[180px]"
          >
            {stage === 'applying' && (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            )}
            {stage === 'done' && <CheckCircle2 className="mr-2 h-3.5 w-3.5" />}
            {buttonLabel}
          </Button>
        </div>
      </div>
    </footer>
  )
}
