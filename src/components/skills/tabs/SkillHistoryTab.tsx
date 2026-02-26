'use client'
import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, GitBranch, Check, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { type ContentVersion } from '@/lib/mock-data'
import { fetchContentVersions, setLatestVersionApi, restoreVersionApi } from '@/lib/api/skills'
import { isConfigured } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

function VersionEntry({
  v,
  isLast,
  onSetLatest,
  onRestore,
}: {
  v: ContentVersion
  isLast: boolean
  onSetLatest: (version: number) => void
  onRestore: (version: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showRestore, setShowRestore] = useState(false)

  const date = new Date(v.created_at)
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  const contentPreview = v.content_md.slice(0, 200)

  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center shrink-0">
        <div
          className={cn(
            'w-2.5 h-2.5 rounded-full border-2 mt-5 shrink-0',
            v.is_latest ? 'bg-accent border-accent' : 'bg-card border-border'
          )}
        />
        {!isLast && <div className="w-px flex-1 bg-border/60 my-1" />}
      </div>
      <div className={cn('flex-1 min-w-0', !isLast && 'pb-4')}>
        <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
          <div className="flex items-start gap-3 p-4 hover:bg-muted/30 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <p className="text-[13px] font-semibold text-foreground font-mono">v{v.version}</p>
                {v.is_latest && (
                  <Badge className="text-[10px] py-0 bg-accent/15 text-accent border-accent/30">
                    Latest
                  </Badge>
                )}
              </div>
              <p className="text-[12px] text-muted-foreground truncate">{v.title}</p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                {dateStr}
                {v.tags.length > 0 && (
                  <span className="ml-2 text-[10px]">
                    {v.tags.slice(0, 3).join(', ')}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!v.is_latest && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] gap-1 hidden sm:flex"
                    onClick={() => onSetLatest(v.version)}
                  >
                    <Check className="h-3 w-3" />
                    Set Latest
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] gap-1"
                    onClick={() => setShowRestore(true)}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Restore
                  </Button>
                </>
              )}
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1 rounded-md hover:bg-muted text-muted-foreground transition-colors"
                aria-label="Toggle content preview"
              >
                {expanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          {expanded && (
            <div className="border-t border-border/60 bg-muted/20 p-4">
              <div className="space-y-2 text-[12px]">
                <div>
                  <span className="font-semibold text-muted-foreground">Description:</span>{' '}
                  <span className="text-foreground/80">{v.description || '(none)'}</span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground">Tags:</span>{' '}
                  <span className="text-foreground/80">
                    {v.tags.length > 0 ? v.tags.join(', ') : '(none)'}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-muted-foreground">Content preview:</span>
                  <pre className="mt-1 text-[11px] font-mono text-foreground/70 whitespace-pre-wrap bg-muted/40 rounded-md p-2 max-h-48 overflow-auto">
                    {contentPreview}
                    {v.content_md.length > 200 && '...'}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showRestore && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowRestore(false)}
        >
          <div
            className="w-full max-w-sm bg-card border border-border rounded-xl shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground mb-2">
              Restore version {v.version}?
            </h3>
            <p className="text-[13px] text-muted-foreground mb-2">
              This will restore the skill content to version {v.version} and create a new version.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[13px]"
                onClick={() => setShowRestore(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8 text-[13px]"
                onClick={() => {
                  setShowRestore(false)
                  onRestore(v.version)
                }}
              >
                Restore
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type SkillVersionsTabProps = {
  skillSlug: string
  onRestored?: () => void
}

export function SkillVersionsTab({ skillSlug, onRestored }: SkillVersionsTabProps) {
  const [versions, setVersions] = useState<ContentVersion[]>([])
  const [loading, setLoading] = useState(true)

  const loadVersions = () => {
    if (!isConfigured()) {
      setLoading(false)
      return
    }
    setLoading(true)
    fetchContentVersions(skillSlug)
      .then(setVersions)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadVersions()
  }, [skillSlug])

  const handleSetLatest = async (version: number) => {
    try {
      await setLatestVersionApi(skillSlug, version)
      toast.success(`Version ${version} set as latest — content updated`)
      loadVersions()
      onRestored?.()
    } catch {
      toast.error('Failed to set latest version')
    }
  }

  const handleRestore = async (version: number) => {
    try {
      await restoreVersionApi(skillSlug, version)
      toast.success(`Restored to version ${version}`)
      loadVersions()
      onRestored?.()
    } catch {
      toast.error('Failed to restore version')
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <div className="h-5 w-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 px-6 sm:px-12 py-6 mt-0 overflow-auto animate-in fade-in duration-200">
      <div className="max-w-3xl">
        {versions.length > 0 ? (
          versions.map((v, i) => (
            <VersionEntry
              key={v.version}
              v={v}
              isLast={i === versions.length - 1}
              onSetLatest={handleSetLatest}
              onRestore={handleRestore}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <div className="w-12 h-12 rounded-xl bg-muted/80 flex items-center justify-center mb-4">
              <GitBranch className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <p className="text-[14px] font-medium text-foreground mb-1">No versions yet</p>
            <p className="text-[13px] text-muted-foreground text-center max-w-xs">
              Versions will appear here as the skill is saved. Each save creates a new version.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// Keep backward-compatible export for old code
export function SkillHistoryTab({ revisions: _ }: { revisions: unknown[] }) {
  return (
    <div className="flex-1 flex items-center justify-center py-16 text-muted-foreground text-sm">
      History has been replaced by Versions.
    </div>
  )
}
