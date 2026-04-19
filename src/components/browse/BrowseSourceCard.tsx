'use client'
import { useState, useRef, useEffect } from 'react'
import { MoreHorizontal, GitBranch, Pin, Link2Off, RefreshCw } from 'lucide-react'
import { deleteSource, refreshSource, type SourceListItem } from '@/lib/api/imports'
import { toast } from 'sonner'

type Props = {
  source: SourceListItem
  onDriftClick?: (source: SourceListItem) => void
  onChanged?: () => void
}

export function BrowseSourceCard({ source: s, onDriftClick, onChanged }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    if (menuOpen) document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [menuOpen])

  async function doUnlink(removeSkills: boolean) {
    try {
      await deleteSource(s.id, removeSkills)
      toast.success(removeSkills ? 'Source + skills removed' : 'Source unlinked; skills kept as local-only')
      setConfirmUnlink(false)
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unlink failed')
    }
  }

  async function doResync() {
    try {
      await refreshSource(s.id, 'preview')
      toast.success('Refreshed')
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Resync failed')
    }
    setMenuOpen(false)
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 relative">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">
            {s.owner}/{s.repo}
          </div>
          <div className="text-xs text-muted-foreground">
            {s.ref ?? 'main'} · {s.imported_at_sha?.slice(0, 7)} · {s.skill_count} skills
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill
            status={s.status}
            summary={s.drift_summary}
            onDriftClick={onDriftClick ? () => onDriftClick(s) : undefined}
          />
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(v => !v)}
              className="rounded p-1 hover:bg-muted"
              aria-label="Source actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-10 mt-1 w-52 rounded-md border border-border/50 bg-card shadow-lg"
              >
                <MenuItem
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  label="Resync upstream"
                  onClick={doResync}
                />
                <MenuItem
                  icon={<Pin className="h-3.5 w-3.5" />}
                  label={s.pinned ? 'Unpin commit' : 'Pin to this commit'}
                  onClick={() => {
                    toast.info('Pin/unpin coming in v1.1')
                    setMenuOpen(false)
                  }}
                />
                <MenuItem
                  icon={<GitBranch className="h-3.5 w-3.5" />}
                  label="Change tracked ref..."
                  onClick={() => {
                    toast.info('Change ref coming in v1.1')
                    setMenuOpen(false)
                  }}
                />
                <div className="my-1 h-px bg-border/40" />
                <MenuItem
                  icon={<Link2Off className="h-3.5 w-3.5" />}
                  label="Unlink source..."
                  onClick={() => {
                    setMenuOpen(false)
                    setConfirmUnlink(true)
                  }}
                  destructive
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmUnlink && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/30"
          onClick={() => setConfirmUnlink(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Unlink source"
            className="w-80 rounded-lg border border-border/50 bg-card p-4 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h4 className="text-sm font-semibold">Unlink this source?</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              {s.skill_count} imported skills will become local-only, OR you can remove them with the source.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => doUnlink(false)}
                className="rounded-md border border-border/60 bg-card px-3 py-1.5 text-xs"
              >
                Keep skills as local-only
              </button>
              <button
                type="button"
                onClick={() => doUnlink(true)}
                className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
              >
                Remove skills too
              </button>
              <button
                type="button"
                onClick={() => setConfirmUnlink(false)}
                className="text-[11px] text-muted-foreground hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted ${destructive ? 'text-destructive' : ''}`}
    >
      {icon}
      {label}
    </button>
  )
}

function StatusPill({
  status,
  summary,
  onDriftClick,
}: {
  status: string
  summary?: { new: number; changed: number; removed: number }
  onDriftClick?: () => void
}) {
  if (status === 'up_to_date') {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        up to date
      </span>
    )
  }
  if (status === 'drift') {
    const label = summary ? `${summary.new} new · ${summary.changed} changed` : 'drift'
    if (onDriftClick) {
      return (
        <button
          type="button"
          onClick={onDriftClick}
          className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/25 dark:text-amber-400"
        >
          {label}
        </button>
      )
    }
    return (
      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        {label}
      </span>
    )
  }
  return (
    <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
      {status === 'unreachable' ? 'unreachable' : status}
    </span>
  )
}
