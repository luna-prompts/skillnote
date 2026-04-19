'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  Folder,
  FolderPlus,
  GitBranch,
  Github,
  GripVertical,
  Loader2,
  Plus,
  Search,
  Sparkle,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { nightOwl, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'

import { applyImport, type InspectResponse, type InspectSkill } from '@/lib/api/imports'
import { stripFrontmatter } from '@/lib/frontmatter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

type Stage = 'preview' | 'applying' | 'done'

const MAX_SKILLS_PER_COLLECTION = 15

type ApplyResult = {
  imported: number
  renamed: number
  collection_slug: string
}

type Props = {
  preview: InspectResponse
  input: string
  existingCollectionSlugs: string[]
  onBack: () => void
  onImported: () => void
  onAddAnother: () => void
  onViewLibrary: () => void
}

function slugifyLoose(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** Mouse-drag splitter; avoids react-resizable-panels v4 layout glitches. */
function useResizableSidebar(initial: number, min: number, max: number) {
  const [width, setWidth] = useState(initial)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const onMouseDown = useCallback(() => {
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      setWidth(Math.max(min, Math.min(max, x)))
    }
    function onUp() {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [min, max])

  return { width, onMouseDown, containerRef }
}

export function ImportWorkspace({
  preview,
  input,
  existingCollectionSlugs,
  onBack,
  onImported,
  onAddAnother,
  onViewLibrary,
}: Props) {
  const initial = new Set(preview.skills.map((s) => s.name))
  const [selection, setSelection] = useState<Set<string>>(initial)
  const [targetSlug, setTargetSlug] = useState(preview.suggested_collection_slug ?? '')
  const [focused, setFocused] = useState<string | null>(preview.skills[0]?.name ?? null)
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage>('preview')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [result, setResult] = useState<ApplyResult | null>(null)

  const skills = preview.skills
  const source = preview.source

  const { width: sidebarWidth, onMouseDown: onSplitterDown, containerRef } = useResizableSidebar(
    420,
    300,
    640,
  )

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

  const normalizedSlug = slugifyLoose(targetSlug)

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
      { pct: 25, label: 'Creating collection…', after: 0 },
      { pct: 55, label: `Writing ${selection.size} skill${selection.size === 1 ? '' : 's'}…`, after: 600 },
      { pct: 82, label: 'Finalizing…', after: 1500 },
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
        // If a skill with the same slug already exists in the collection, overwrite it.
        on_conflict: 'replace',
      })
      clearInterval(timer)
      setProgress(100)
      setProgressLabel('Done')
      const renamed = r.imported.filter((s) => s.renamed_reason).length
      toast.success(
        `Imported ${r.imported.length} skill${r.imported.length === 1 ? '' : 's'} into ${r.collection_slug}${renamed ? ` · ${renamed} renamed` : ''}`,
      )
      setResult({
        imported: r.imported.length,
        renamed,
        collection_slug: r.collection_slug,
      })
      setStage('done')
      onImported()
    } catch (err) {
      clearInterval(timer)
      toast.error(err instanceof Error ? err.message : 'Import failed')
      setStage('preview')
      setProgress(0)
      setProgressLabel('')
    }
  }

  const disabled = stage === 'applying' || stage === 'done'

  if (stage === 'done' && result) {
    return (
      <DoneCard
        result={result}
        onAddAnother={() => {
          setStage('preview')
          setResult(null)
          setProgress(0)
          setProgressLabel('')
          onAddAnother()
        }}
        onViewLibrary={onViewLibrary}
      />
    )
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] min-h-[720px] flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        <CollectionHeader
          source={source}
          selectionCount={selection.size}
          totalCount={skills.length}
        />

        <div ref={containerRef} className="flex min-h-0 flex-1">
          <div
            style={{ width: sidebarWidth }}
            className="flex min-h-0 shrink-0 flex-col"
          >
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
          </div>

          <Splitter onMouseDown={onSplitterDown} />

          <div className="flex min-h-0 min-w-0 flex-1">
            <SkillPreview skill={focusedSkill} />
          </div>
        </div>

        <Footer
          selectionCount={selection.size}
          totalCount={skills.length}
          targetSlug={targetSlug}
          onTargetSlugChange={setTargetSlug}
          normalizedSlug={normalizedSlug}
          existingSlugs={existingCollectionSlugs}
          suggestedSlug={preview.suggested_collection_slug ?? ''}
          stage={stage}
          progress={progress}
          progressLabel={progressLabel}
          onImport={handleImport}
          onCancel={onBack}
        />
    </div>
  )
}

function Splitter({ onMouseDown }: { onMouseDown: () => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      className="group/split relative flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-border/40 transition-colors hover:bg-accent/40"
    >
      <div className="flex h-10 w-3 items-center justify-center rounded-sm bg-background/80 opacity-0 shadow-sm ring-1 ring-border/60 transition-opacity group-hover/split:opacity-100">
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </div>
    </div>
  )
}

function CollectionHeader({
  source,
  selectionCount,
  totalCount,
}: {
  source: InspectResponse['source']
  selectionCount: number
  totalCount: number
}) {
  const repoUrl = `https://github.com/${source.owner}/${source.repo}`
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-gradient-to-b from-muted/30 to-muted/10 px-5 py-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <a
          href={repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group/chip inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-[12px] shadow-sm transition-colors hover:border-accent/40 hover:bg-accent/5"
          title={`${source.owner}/${source.repo}`}
        >
          <Github className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover/chip:text-foreground" />
          <span className="truncate font-mono text-muted-foreground group-hover/chip:text-foreground">
            {source.owner}
          </span>
          <span className="text-muted-foreground/40">/</span>
          <span className="truncate font-mono font-medium text-foreground">{source.repo}</span>
        </a>

        <span className="text-muted-foreground/40">·</span>

        <span
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-[12px] shadow-sm"
          title={`branch: ${source.ref ?? 'main'}`}
        >
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-foreground">{source.ref ?? 'main'}</span>
        </span>

        {source.subpath && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-[12px] shadow-sm"
              title={source.subpath}
            >
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-foreground">{source.subpath}</span>
            </span>
          </>
        )}
      </div>

      <div className="shrink-0 rounded-full border border-border/60 bg-background px-3 py-1 text-[12px] font-medium tabular-nums shadow-sm">
        <span className="text-foreground">{selectionCount}</span>
        <span className="text-muted-foreground"> / {totalCount} skills</span>
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
    <aside className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2.5 border-b border-border/40 bg-muted/10 px-4 py-3">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Select skills to add
        </div>
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
          skills.map((s, idx) => {
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
                className={cn(
                  'group/row relative flex min-w-0 cursor-pointer items-start gap-2.5 border-l-2 border-b border-border/20 px-3.5 py-3 text-left last:border-b-0 transition-colors',
                  isFocused
                    ? 'border-l-accent bg-accent/10'
                    : 'border-l-transparent hover:bg-muted/40',
                )}
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
                <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground/50">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-foreground">{s.name}</div>
                  {s.description && (
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">
                      {s.description}
                    </p>
                  )}
                  {s.path && (
                    <p
                      className={cn(
                        'mt-1 truncate font-mono text-[10.5px] text-muted-foreground/60 transition-opacity',
                        isFocused ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
                      )}
                    >
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


function slugifyHeading(text: string) {
  return text.toLowerCase().replace(/[^\w]+/g, '-').replace(/(^-|-$)/g, '')
}

function SkillPreview({ skill }: { skill: InspectSkill | null }) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const strippedContent = useMemo(() => {
    if (!skill?.body) return ''
    // react-markdown renders raw HTML as text by default, so literal
    // <!-- ... --> blocks in the source show up as visible strings.
    // Strip them before rendering; they're metadata for the upstream
    // repo's build tooling, not useful to a SkillNote reader.
    return stripFrontmatter(skill.body).replace(/<!--[\s\S]*?-->/g, '')
  }, [skill?.body])

  if (!skill) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Select a skill on the left to preview how it will appear after import.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-col">
      {/* File-header bar mirrors SkillViewTab */}
      <div className="flex items-center gap-2.5 bg-muted/20 px-6 py-2.5 sm:px-10">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        <span className="shrink-0 font-mono text-[12px] tracking-wide text-muted-foreground/60">
          SKILL.md
        </span>
        <span className="truncate text-[11px] text-muted-foreground/40">
          · post-import preview
        </span>
      </div>
      <hr className="border-border/30" />

      {/* Skill meta */}
      <div className="min-w-0 border-b border-border/30 px-6 py-5 sm:px-10 lg:px-14">
        <h1 className="truncate text-[22px] font-semibold leading-tight text-foreground">
          {skill.name}
        </h1>
        {skill.description && (
          <p className="mt-1.5 max-w-[52rem] break-words text-[14px] leading-relaxed text-muted-foreground">
            {skill.description}
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/70">
          {skill.path && <span className="font-mono">{skill.path}</span>}
          {skill.license && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px]">{skill.license}</span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex gap-8 overflow-hidden px-6 py-7 sm:px-10 sm:py-9 lg:px-14">
          <div className="min-w-0 max-w-[52rem] flex-1 overflow-hidden">
            {strippedContent ? (
              <div className="ProseMirror skill-view-content max-w-none" style={{ padding: 0 }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    pre({ children }) {
                      return <>{children}</>
                    },
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '')
                      const codeString = String(children).replace(/\n$/, '')
                      if (match) {
                        return (
                          <div
                            className="group/pre not-prose relative my-4 max-w-[calc(100vw-2rem)] overflow-hidden sm:max-w-none"
                            style={{ borderRadius: '12px' }}
                          >
                            <div className="absolute right-3 top-2.5 z-10 flex items-center gap-2">
                              <span
                                className="font-mono text-[10px] uppercase tracking-widest"
                                style={{ color: 'rgba(255,255,255,0.3)' }}
                              >
                                {match[1]}
                              </span>
                            </div>
                            <SyntaxHighlighter
                              style={isDark ? nightOwl : oneLight}
                              language={match[1]}
                              PreTag="div"
                              customStyle={{
                                margin: 0,
                                borderRadius: '12px',
                                fontSize: '13px',
                                lineHeight: '1.6',
                                padding: '1.25rem 1.5rem',
                                background: isDark ? '#011627' : '#f0f1f3',
                                border: isDark ? 'none' : '1px solid #dde0e4',
                                overflowX: 'auto',
                                maxWidth: '100%',
                              }}
                            >
                              {codeString}
                            </SyntaxHighlighter>
                          </div>
                        )
                      }
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      )
                    },
                    h1({ children }) {
                      const id = slugifyHeading(String(children))
                      return (
                        <h1 id={id} className="scroll-mt-6">
                          {children}
                        </h1>
                      )
                    },
                    h2({ children }) {
                      const id = slugifyHeading(String(children))
                      return (
                        <h2 id={id} className="scroll-mt-6">
                          {children}
                        </h2>
                      )
                    },
                    h3({ children }) {
                      const id = slugifyHeading(String(children))
                      return (
                        <h3 id={id} className="scroll-mt-6">
                          {children}
                        </h3>
                      )
                    },
                    a({ href, children }) {
                      const isExternal = href?.startsWith('http')
                      return (
                        <a
                          href={href}
                          {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                          className="text-accent hover:underline"
                        >
                          {children}
                        </a>
                      )
                    },
                    table({ children }) {
                      return (
                        <div className="not-prose my-5 max-w-[calc(100vw-2rem)] overflow-x-auto sm:max-w-none">
                          <table className="w-full border-collapse text-[14px]">{children}</table>
                        </div>
                      )
                    },
                    thead({ children }) {
                      return <thead className="border-b border-border/60">{children}</thead>
                    },
                    tbody({ children }) {
                      return <tbody className="divide-y divide-border/40">{children}</tbody>
                    },
                    tr({ children }) {
                      return <tr className="transition-colors hover:bg-muted/30">{children}</tr>
                    },
                    th({ children }) {
                      return (
                        <th className="whitespace-nowrap px-4 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {children}
                        </th>
                      )
                    },
                    td({ children }) {
                      return <td className="px-4 py-2.5 align-top text-[14px] text-foreground">{children}</td>
                    },
                  }}
                >
                  {strippedContent}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border/40 p-4 text-xs text-muted-foreground">
                No body returned. The full file will still be imported.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Footer({
  selectionCount,
  totalCount,
  targetSlug,
  onTargetSlugChange,
  normalizedSlug,
  existingSlugs,
  suggestedSlug,
  stage,
  progress,
  progressLabel,
  onImport,
  onCancel,
}: {
  selectionCount: number
  totalCount: number
  targetSlug: string
  onTargetSlugChange: (v: string) => void
  normalizedSlug: string
  existingSlugs: string[]
  suggestedSlug: string
  stage: Stage
  progress: number
  progressLabel: string
  onImport: () => void
  onCancel: () => void
}) {
  const disabled = stage === 'applying' || stage === 'done'
  const hasSkills = totalCount > 0
  const overCap = selectionCount > MAX_SKILLS_PER_COLLECTION
  const buttonLabel =
    stage === 'applying'
      ? 'Adding…'
      : stage === 'done'
        ? 'Added'
        : hasSkills
          ? `Add ${selectionCount} to collection`
          : 'Track source'

  return (
    <footer className="border-t border-border/60 bg-gradient-to-t from-muted/20 to-muted/5 px-5 py-4">
      {overCap && stage === 'preview' && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            You&apos;ve selected <span className="font-semibold">{selectionCount}</span> skills, but
            collections are capped at <span className="font-semibold">15</span>. Claude Code
            truncates descriptions past that, so skills stop triggering reliably. Consider
            splitting this into multiple themed collections.
          </span>
        </div>
      )}
      {stage !== 'preview' && (
        <div className="mb-3 flex items-center gap-3">
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{progressLabel}</span>
              <span className="tabular-nums">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-1" />
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <FolderPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
          <label htmlFor="collection-name" className="shrink-0 text-[12px] font-medium text-foreground/80">
            Collection
          </label>
          <CollectionCombobox
            value={targetSlug}
            onChange={onTargetSlugChange}
            normalizedSlug={normalizedSlug}
            existingSlugs={existingSlugs}
            suggestedSlug={suggestedSlug}
            disabled={disabled}
            canImport={!disabled && !!normalizedSlug && !(hasSkills && selectionCount === 0)}
            onSubmit={onImport}
          />
        </div>
        <div className="flex items-center gap-2 md:self-end">
          <Button variant="ghost" onClick={onCancel} disabled={stage === 'applying'}>
            Cancel
          </Button>
          <Button
            onClick={onImport}
            disabled={disabled || (hasSkills && selectionCount === 0) || !normalizedSlug}
            className="h-10 min-w-[220px]"
          >
            {stage === 'applying' && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {stage === 'done' && <CheckCircle2 className="mr-2 h-3.5 w-3.5" />}
            {buttonLabel}
          </Button>
        </div>
      </div>
    </footer>
  )
}

function CollectionCombobox({
  value,
  onChange,
  normalizedSlug,
  existingSlugs,
  suggestedSlug,
  disabled,
  canImport,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  normalizedSlug: string
  existingSlugs: string[]
  suggestedSlug: string
  disabled: boolean
  canImport: boolean
  onSubmit: () => void
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const activeRowRef = useRef<HTMLButtonElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // Auto-focus filter input when popover opens; reset filter on each open
  useEffect(() => {
    if (open) {
      setFilter('')
      setActiveIdx(0)
      requestAnimationFrame(() => filterRef.current?.focus())
    }
  }, [open])

  // Keep the active row in view as the user navigates with the keyboard
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const uniqSorted = useMemo(
    () => Array.from(new Set(existingSlugs)).sort((a, b) => a.localeCompare(b)),
    [existingSlugs],
  )

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return uniqSorted
    return uniqSorted.filter((s) => s.toLowerCase().includes(f))
  }, [uniqSorted, filter])

  const suggestionExistsAsCollection = !!suggestedSlug && existingSlugs.includes(suggestedSlug)

  // Build the row list (flat, for keyboard nav)
  type Row =
    | { kind: 'create'; slug: string }
    | { kind: 'existing'; slug: string; recommended: boolean }
  const rows: Row[] = []

  // Create-new row: show when the typed value doesn't exist AND fuzzy-matches the current filter
  const createMatchesFilter =
    normalizedSlug.length > 0 &&
    (!filter.trim() || normalizedSlug.toLowerCase().includes(filter.trim().toLowerCase()))
  if (createMatchesFilter && !existingSlugs.includes(normalizedSlug)) {
    rows.push({ kind: 'create', slug: normalizedSlug })
  }

  // Pull the recommended existing collection to the top if it matches the filter
  const pinnedRecommended =
    suggestionExistsAsCollection && filtered.includes(suggestedSlug) ? suggestedSlug : null
  if (pinnedRecommended) {
    rows.push({ kind: 'existing', slug: pinnedRecommended, recommended: true })
  }
  for (const s of filtered) {
    if (s === pinnedRecommended) continue
    rows.push({ kind: 'existing', slug: s, recommended: false })
  }

  const pick = (row: Row) => {
    onChange(row.slug)
    setOpen(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const onPopoverKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(rows.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      inputRef.current?.focus()
    } else if (e.key === 'Enter') {
      if (rows[activeIdx]) {
        e.preventDefault()
        pick(rows[activeIdx])
      }
    }
  }

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1 max-w-md">
      <Input
        ref={inputRef}
        id="collection-name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
          } else if (e.key === 'Enter' && !open && canImport) {
            e.preventDefault()
            onSubmit()
          }
        }}
        placeholder="pick or name a collection"
        className="h-10 pr-10 font-mono text-[13px] shadow-sm"
        disabled={disabled}
        aria-autocomplete="list"
        aria-expanded={open}
        role="combobox"
      />
      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o)
            inputRef.current?.focus()
          }}
          disabled={disabled}
          aria-label="Browse collections"
          className="rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <div className="absolute bottom-full z-20 mb-1.5 w-[min(30rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border/60 bg-popover text-popover-foreground shadow-lg">
          {/* Dedicated search input, Jira-style */}
          <div className="relative border-b border-border/40 bg-muted/10 p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={filterRef}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value)
                setActiveIdx(0)
              }}
              onKeyDown={onPopoverKeyDown}
              placeholder={`Search ${uniqSorted.length} collection${uniqSorted.length === 1 ? '' : 's'}…`}
              className="h-8 pl-8 text-[12.5px]"
              aria-label="Filter collections"
            />
          </div>

          {/* Section label */}
          <div className="flex items-center justify-between px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <span>Collections</span>
            <span className="tabular-nums text-muted-foreground/70">
              {filter ? `${filtered.length} of ${uniqSorted.length}` : uniqSorted.length}
            </span>
          </div>

          {/* Scrollable list */}
          <div className="max-h-72 overflow-auto pb-1">
            {rows.length === 0 ? (
              <div className="px-3 py-5 text-center text-[11.5px] text-muted-foreground">
                {uniqSorted.length === 0
                  ? 'No collections yet. Type a name in the field above to create one.'
                  : `No match for "${filter}". Clear the filter to see all.`}
              </div>
            ) : (
              rows.map((row, i) => {
                const active = i === activeIdx
                if (row.kind === 'create') {
                  return (
                    <button
                      key="__create"
                      ref={active ? activeRowRef : undefined}
                      type="button"
                      onMouseEnter={() => setActiveIdx(i)}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        pick(row)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors',
                        active ? 'bg-accent/10' : 'hover:bg-muted/60',
                      )}
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0 text-accent" />
                      <span className="min-w-0 flex-1">
                        <span className="text-muted-foreground">Create new</span>
                        <span className="ml-1.5 font-mono text-foreground">{row.slug}</span>
                      </span>
                    </button>
                  )
                }
                const isSelected = normalizedSlug === row.slug
                return (
                  <button
                    key={row.slug}
                    ref={active ? activeRowRef : undefined}
                    type="button"
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pick(row)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors',
                      active ? 'bg-accent/10' : 'hover:bg-muted/60',
                    )}
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate font-mono',
                        isSelected ? 'text-foreground' : 'text-foreground/90',
                      )}
                    >
                      {highlight(row.slug, filter)}
                    </span>
                    {row.recommended && (
                      <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-accent">
                        <Sparkle className="mr-0.5 inline h-2.5 w-2.5" />
                        Recommended
                      </span>
                    )}
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                  </button>
                )
              })
            )}
          </div>

          <div className="border-t border-border/40 bg-muted/20 px-3 py-1.5 text-[10.5px] text-muted-foreground">
            <kbd className="rounded border border-border/60 bg-background px-1 font-mono text-[10px]">
              ↑↓
            </kbd>{' '}
            navigate ·{' '}
            <kbd className="rounded border border-border/60 bg-background px-1 font-mono text-[10px]">
              ↵
            </kbd>{' '}
            select ·{' '}
            <kbd className="rounded border border-border/60 bg-background px-1 font-mono text-[10px]">
              esc
            </kbd>{' '}
            close
          </div>
        </div>
      )}
    </div>
  )
}

/** Wrap a filter match in bold so Jira-style search results are readable at a glance. */
function highlight(slug: string, filter: string) {
  const f = filter.trim().toLowerCase()
  if (!f) return slug
  const idx = slug.toLowerCase().indexOf(f)
  if (idx < 0) return slug
  return (
    <>
      {slug.slice(0, idx)}
      <span className="rounded bg-accent/20 px-0.5 font-semibold text-foreground">
        {slug.slice(idx, idx + f.length)}
      </span>
      {slug.slice(idx + f.length)}
    </>
  )
}

function DoneCard({
  result,
  onAddAnother,
  onViewLibrary,
}: {
  result: ApplyResult
  onAddAnother: () => void
  onViewLibrary: () => void
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center rounded-xl border border-border/60 bg-card px-8 py-14 text-center shadow-sm">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
        <CheckCircle2 className="h-7 w-7" />
      </div>
      <h2 className="text-lg font-semibold">
        Added to <span className="font-mono">{result.collection_slug}</span>
      </h2>
      <p className="mt-1.5 max-w-md text-[13px] text-muted-foreground">
        {result.imported} skill{result.imported === 1 ? '' : 's'} imported
        {result.renamed > 0 && ` · ${result.renamed} renamed to avoid conflicts`}
        . Everything is ready in your library.
      </p>
      <div className="mt-7 flex flex-col items-stretch gap-2 sm:flex-row">
        <Button variant="outline" onClick={onAddAnother}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add another
        </Button>
        <Button onClick={onViewLibrary}>
          View collection
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
