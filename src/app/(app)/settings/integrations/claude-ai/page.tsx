'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Chrome,
  ExternalLink,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/topbar'
import { ActivityFeed } from '@/components/integrations/claude-ai/activity-feed'
import { ConfirmDisconnectDialog } from '@/components/integrations/claude-ai/confirm-disconnect-dialog'
import { HealthCard } from '@/components/integrations/claude-ai/health-card'
import { IntegrationCardSkeleton } from '@/components/integrations/claude-ai/skeleton'
import { ClaudeAISetupStepper } from '@/components/integrations/claude-ai/setup-stepper'
import { SyncQueuePanel } from '@/components/integrations/claude-ai/sync-queue'
import { AnalyticsPanel } from '@/components/integrations/claude-ai/analytics-panel'
import { DiagnosticButton } from '@/components/integrations/claude-ai/diagnostic-button'
import {
  ConflictListItem,
  ConflictPreview,
  IntegrationStatusResponse,
  disconnectIntegration,
  fetchConflictPreview,
  listConflicts,
  listIntegrations,
  patchIntegration,
  resolveConflict,
} from '@/lib/api/claude-ai'

export default function ClaudeAISettingsPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatusResponse[] | null>(null)
  const [conflicts, setConflicts] = useState<ConflictListItem[]>([])
  const [reloading, setReloading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pendingDisconnect, setPendingDisconnect] = useState<{ id: string; label: string | null } | null>(null)

  const refresh = useCallback(async () => {
    setReloading(true)
    try {
      const [ints, cons] = await Promise.all([listIntegrations(), listConflicts()])
      setIntegrations(ints)
      setConflicts(cons)
      setLoadError(null)
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : 'unknown'
      setLoadError(msg)
      // Only toast on first load — silent retries afterward to avoid spam.
      if (integrations === null) {
        toast.error(`Could not load integrations: ${msg}`)
      }
    } finally {
      setReloading(false)
    }
  }, [integrations])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 10_000) // 10s — feels real-time without backend pressure
    return () => clearInterval(t)
    // Intentionally empty deps — we DON'T want the timer to reset on every
    // refresh; the closure captures `refresh` which captures `integrations`,
    // but the latest `refresh` is always invoked because state is read at
    // call time inside `refresh`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const confirmDisconnect = useCallback(async () => {
    if (!pendingDisconnect) return
    const { id, label } = pendingDisconnect
    setPendingDisconnect(null)
    try {
      // Optimistically remove from the UI immediately so the user sees feedback
      // — matches Linear's pattern of "act first, retry on failure."
      setIntegrations((prev) => prev?.filter((i) => i.id !== id) ?? null)
      await disconnectIntegration(id)
      toast.success(`Disconnected ${label ?? 'browser'}`)
      void refresh()
    } catch (e) {
      // Restore on failure.
      void refresh()
      toast.error(`Failed to disconnect: ${(e as Error).message}`)
    }
  }, [pendingDisconnect, refresh])

  const hasAny = integrations && integrations.length > 0

  return (
    <>
      <TopBar />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Breadcrumbs />

        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
          Sync to claude.ai
        </h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          Two-way sync between your SkillNote and your claude.ai account, via a browser extension you install once.
        </p>

        {/* Health card — sits at the top so admins see the system pulse. */}
        <section className="mt-8">
          <HealthCard />
        </section>

        {/* Interactive setup stepper — replaces the static 4-step card. Renders
            nothing once the user has at least one active integration. */}
        <section className="mt-6" data-testid="claude-ai-setup-card">
          <ClaudeAISetupStepper
            integrations={integrations}
            onPairingApproved={() => void refresh()}
          />
        </section>

        {/* Connected browsers */}
        <section className="mt-8">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-[15px] font-semibold text-foreground">Connected browsers</h2>
            <div className="flex items-center gap-2">
              <DiagnosticButton />
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={reloading}
                className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${reloading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {integrations === null ? (
              <>
                <IntegrationCardSkeleton />
                <IntegrationCardSkeleton />
              </>
            ) : !hasAny ? (
              <EmptyBrowsersState />
            ) : (
              integrations.map((i) => (
                <IntegrationRow
                  key={i.id}
                  integration={i}
                  onDisconnect={() =>
                    setPendingDisconnect({ id: i.id, label: i.browser_label })
                  }
                  onPolicyChanged={(updated) =>
                    setIntegrations((prev) =>
                      prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev,
                    )
                  }
                />
              ))
            )}
          </div>
        </section>

        {/* Conflicts */}
        {conflicts.length > 0 && (
          <section className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h2 className="text-[15px] font-semibold text-foreground">
                  Conflicts ({conflicts.length})
                </h2>
              </div>
              {conflicts.length >= 2 && (
                <ResolveAllMenu
                  count={conflicts.length}
                  onResolveAll={async (kind) => {
                    const snapshot = conflicts
                    // Optimistic clear — re-populate on failure.
                    setConflicts([])
                    const results = await Promise.allSettled(
                      snapshot.map((c) => resolveConflict(c.link_id, kind)),
                    )
                    const failures = results.filter((r) => r.status === 'rejected')
                    if (failures.length === 0) {
                      toast.success(`Resolved ${snapshot.length} conflicts`)
                    } else {
                      toast.error(
                        `Resolved ${snapshot.length - failures.length} of ${snapshot.length}; refreshing`,
                      )
                      void refresh()
                    }
                  }}
                />
              )}
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              These skills changed on both sides since the last sync. Pick a winner per skill — or use Resolve all to apply the same choice everywhere.
            </p>
            <div className="mt-3 space-y-2">
              {conflicts.map((c) => (
                <ConflictRow
                  key={c.link_id}
                  conflict={c}
                  onResolved={() => {
                    // Optimistically remove the row immediately. Background
                    // refresh will re-sync the truth in the next poll.
                    setConflicts((prev) => prev.filter((x) => x.link_id !== c.link_id))
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* Live sync queue — answers "is my data flowing right now?" */}
        {hasAny && (
          <section className="mt-8">
            <SyncQueuePanel />
          </section>
        )}

        {/* 7-day analytics — sync throughput + per-browser breakdown */}
        {hasAny && (
          <section className="mt-6">
            <AnalyticsPanel />
          </section>
        )}

        {/* Load error banner — only shows after the first successful load */}
        {loadError && integrations !== null && (
          <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              Last refresh failed: <code className="text-[11px]">{loadError}</code>. Retrying every 10s.
            </span>
          </div>
        )}

        {/* Activity preview */}
        {hasAny && (
          <section className="mt-10">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-foreground">Recent activity</h2>
              <Link
                href="/settings/integrations/claude-ai/activity"
                className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
              >
                View all →
              </Link>
            </div>
            <div className="rounded-lg border border-border bg-card">
              <ActivityFeed pageSize={10} compact />
            </div>
          </section>
        )}
      </div>
      <ConfirmDisconnectDialog
        open={pendingDisconnect !== null}
        browserLabel={pendingDisconnect?.label ?? null}
        onCancel={() => setPendingDisconnect(null)}
        onConfirm={() => void confirmDisconnect()}
      />
    </>
  )
}

function Breadcrumbs() {
  return (
    <div className="mb-2 text-[12px] text-muted-foreground">
      <Link href="/settings" className="hover:text-foreground">
        Settings
      </Link>
      <span className="mx-1.5">/</span>
      <span>claude.ai</span>
    </div>
  )
}

function EmptyBrowsersState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center">
      <div className="mx-auto h-9 w-9 rounded-full bg-muted/40 flex items-center justify-center">
        <Chrome className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="mt-3 text-[13px] font-medium text-foreground">
        No browsers connected yet
      </h3>
      <p className="mt-1 text-[12px] text-muted-foreground max-w-sm mx-auto">
        Follow the steps above. Once you approve a pairing code, the browser
        appears here.
      </p>
    </div>
  )
}

function IntegrationRow({
  integration,
  onDisconnect,
  onPolicyChanged,
}: {
  integration: IntegrationStatusResponse
  onDisconnect: () => void
  onPolicyChanged: (updated: IntegrationStatusResponse) => void
}) {
  const Icon =
    {
      active: CheckCircle2,
      cookie_expired: AlertTriangle,
      disconnected: XCircle,
      error: XCircle,
      pending_approval: Loader2,
    }[integration.status] ?? CheckCircle2
  const tone =
    {
      active: 'text-emerald-500',
      cookie_expired: 'text-amber-500',
      disconnected: 'text-muted-foreground',
      error: 'text-red-500',
      pending_approval: 'text-blue-500',
    }[integration.status] ?? 'text-emerald-500'

  // Human-readable status labels — never expose snake_case to users.
  const statusLabel = {
    active: 'Connected',
    cookie_expired: 'Needs sign-in',
    disconnected: 'Disconnected',
    error: 'Error',
    pending_approval: 'Waiting for approval',
  }[integration.status] ?? 'Unknown'

  return (
    <div
      className="rounded-lg border border-border bg-card p-4 hover:border-muted-foreground/30 transition-colors"
      data-testid={`integration-row-${integration.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Icon
            className={`h-4 w-4 shrink-0 ${tone} ${integration.status === 'pending_approval' ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-foreground truncate">
              {integration.browser_label ?? 'Unnamed browser'}
            </div>
            <div
              className="text-[11px] text-muted-foreground"
              aria-label={`Status: ${statusLabel}`}
            >
              {statusLabel}
              {integration.last_sync_at && (
                <>
                  {' · last synced '}
                  <time
                    dateTime={integration.last_sync_at}
                    title={new Date(integration.last_sync_at).toLocaleString()}
                  >
                    {timeAgo(integration.last_sync_at)}
                  </time>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {integration.status === 'cookie_expired' && (
            <a
              href="https://claude.ai/login"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors border border-amber-500/30"
              title="Open claude.ai in a new tab; once you sign in, sync resumes automatically."
            >
              <ExternalLink className="h-3 w-3" />
              Sign in to claude.ai
            </a>
          )}
          {integration.status !== 'disconnected' && (
            <button
              type="button"
              onClick={onDisconnect}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-foreground hover:bg-muted transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              Disconnect
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
        <Stat label="Skills synced" value={integration.linked_skill_count} />
        <Stat
          label={integration.pending_op_count === 1 ? 'Sync waiting' : 'Syncs waiting'}
          value={integration.pending_op_count}
        />
        <Stat
          label={integration.failed_op_count === 1 ? 'Failed' : 'Failed'}
          value={integration.failed_op_count}
          tone={integration.failed_op_count > 0 ? 'text-red-500' : undefined}
        />
      </div>
      {integration.last_error && (
        <div className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">
          {integration.last_error}
        </div>
      )}
      <ConflictPolicySwitch integration={integration} onChange={onPolicyChanged} />
    </div>
  )
}

function ConflictPolicySwitch({
  integration,
  onChange,
}: {
  integration: IntegrationStatusResponse
  onChange: (updated: IntegrationStatusResponse) => void
}) {
  const [busy, setBusy] = useState(false)
  const handle = async (next: 'ask' | 'skillnote_wins' | 'claude_ai_wins') => {
    if (next === integration.conflict_policy || busy) return
    setBusy(true)
    // Optimistic update — give the user immediate feedback.
    const previous = integration.conflict_policy
    onChange({ ...integration, conflict_policy: next })
    try {
      const updated = await patchIntegration(integration.id, { conflict_policy: next })
      onChange(updated)
      toast.success(`Conflict policy: ${labelFor(next)}`)
    } catch (e) {
      onChange({ ...integration, conflict_policy: previous })
      toast.error(`Failed to update: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-3 flex items-center gap-2 text-[11px]">
      <span className="text-muted-foreground">When both sides change a skill:</span>
      <div className="inline-flex rounded-md border border-border bg-background p-0.5" role="radiogroup" aria-label="Conflict resolution policy">
        {(['ask', 'skillnote_wins', 'claude_ai_wins'] as const).map((opt) => {
          const active = integration.conflict_policy === opt
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy}
              onClick={() => void handle(opt)}
              className={[
                'rounded px-2 py-1 transition-colors',
                active
                  ? 'bg-foreground text-background font-medium'
                  : 'text-muted-foreground hover:text-foreground',
                busy && 'opacity-60 cursor-wait',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {labelFor(opt)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function labelFor(p: 'ask' | 'skillnote_wins' | 'claude_ai_wins'): string {
  return p === 'ask' ? 'Ask me' : p === 'skillnote_wins' ? 'SkillNote wins' : 'claude.ai wins'
}

function ResolveAllMenu({
  count,
  onResolveAll,
}: {
  count: number
  onResolveAll: (kind: 'keep_skillnote' | 'keep_claude_ai' | 'skip') => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const handle = async (kind: 'keep_skillnote' | 'keep_claude_ai' | 'skip') => {
    setOpen(false)
    setBusy(true)
    try {
      await onResolveAll(kind)
    } finally {
      setBusy(false)
    }
  }

  // Close the menu on outside click / Escape — keeps it cheap (no portal).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('[data-resolve-all-menu]')) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  return (
    <div className="relative" data-resolve-all-menu>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-[12px] text-foreground hover:bg-muted transition-colors disabled:opacity-50"
      >
        {busy ? 'Resolving…' : `Resolve all (${count})`}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 min-w-[220px] rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1"
        >
          <MenuItem onClick={() => void handle('keep_skillnote')}>
            <span className="font-medium">Keep SkillNote</span> for all
          </MenuItem>
          <MenuItem onClick={() => void handle('keep_claude_ai')}>
            <span className="font-medium">Keep claude.ai</span> for all
          </MenuItem>
          <MenuItem onClick={() => void handle('skip')}>
            <span>Skip all</span>
            <span className="ml-2 text-[10px] text-muted-foreground">(may re-appear)</span>
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full text-left rounded px-3 py-2 text-[12px] hover:bg-muted transition-colors focus:bg-muted focus:outline-none"
    >
      {children}
    </button>
  )
}

function ConflictRow({
  conflict,
  onResolved,
}: {
  conflict: ConflictListItem
  onResolved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [preview, setPreview] = useState<ConflictPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const togglePreview = async () => {
    if (showPreview) {
      setShowPreview(false)
      return
    }
    setShowPreview(true)
    if (preview === null && previewError === null) {
      try {
        const p = await fetchConflictPreview(conflict.link_id)
        setPreview(p)
      } catch (e) {
        setPreviewError((e as Error).message)
      }
    }
  }

  const resolve = async (kind: 'keep_skillnote' | 'keep_claude_ai' | 'skip') => {
    if (busy) return
    setBusy(true)
    try {
      await resolveConflict(conflict.link_id, kind)
      toast.success(kind === 'skip' ? 'Skipped' : 'Resolved')
      onResolved()
    } catch (e) {
      toast.error(`Failed to resolve: ${(e as Error).message}`)
      setBusy(false)
    }
  }
  return (
    <div
      className="rounded-lg border border-border bg-card p-4"
      data-testid={`conflict-row-${conflict.link_id}`}
    >
      <div className="text-[13px] font-medium text-foreground">
        {conflict.skillnote_skill_name ?? conflict.claude_ai_skill_id}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        On {conflict.integration_label ?? 'a browser'} · last seen{' '}
        {conflict.last_seen_at ? timeAgo(conflict.last_seen_at) : 'unknown'}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolve('keep_skillnote')}
          className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          Keep SkillNote
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolve('keep_claude_ai')}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
        >
          Keep claude.ai
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolve('skip')}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => void togglePreview()}
          aria-expanded={showPreview}
          className="ml-auto rounded-md px-2 py-1.5 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors"
          data-testid={`conflict-preview-toggle-${conflict.link_id}`}
        >
          {showPreview ? 'Hide preview' : 'Show preview'}
        </button>
      </div>
      {showPreview && (
        <ConflictPreviewPanel preview={preview} error={previewError} />
      )}
    </div>
  )
}

function ConflictPreviewPanel({
  preview,
  error,
}: {
  preview: ConflictPreview | null
  error: string | null
}) {
  if (error) {
    return (
      <div
        className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-700 dark:text-red-300"
        data-testid="conflict-preview-error"
      >
        Couldn’t load preview: {error}
      </div>
    )
  }
  if (!preview) {
    return (
      <div
        className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground"
        data-testid="conflict-preview-loading"
      >
        Loading preview…
      </div>
    )
  }

  return (
    <div
      className="mt-3 rounded-md border border-border bg-muted/10 p-3 space-y-3"
      data-testid={`conflict-preview-${preview.link_id}`}
    >
      <p className="text-[11.5px] text-muted-foreground">
        SkillNote and claude.ai have diverging copies of this skill. We
        can only show the SkillNote-side content — the claude.ai content
        lives in your browser.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* SkillNote-side */}
        <div className="rounded-md border border-border bg-background p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-[12.5px] font-semibold text-foreground">
              SkillNote (current)
            </h4>
            {preview.current_version_number !== null && (
              <span className="text-[10.5px] font-mono text-muted-foreground">
                v{preview.current_version_number}
              </span>
            )}
          </div>
          <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[11px] font-mono text-foreground whitespace-pre-wrap break-words">
            {preview.current_content_md ?? '(no content)'}
          </pre>
          {preview.local_changed ? (
            <p className="mt-2 text-[11.5px] text-amber-700 dark:text-amber-300">
              ⚠ You have local edits that haven’t been pushed yet. Picking
              <strong> Keep claude.ai</strong> will overwrite them.
            </p>
          ) : (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              Local content matches what was last pushed to claude.ai —
              safe to pick <strong>Keep claude.ai</strong>.
            </p>
          )}
        </div>

        {/* claude.ai-side */}
        <div className="rounded-md border border-border bg-background p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-[12.5px] font-semibold text-foreground">
              claude.ai (their version)
            </h4>
            {preview.claude_ai_version && (
              <span className="text-[10.5px] font-mono text-muted-foreground">
                {preview.claude_ai_version}
              </span>
            )}
          </div>
          <div className="mt-2 space-y-1.5 text-[11.5px] text-muted-foreground">
            <p>
              Skill ID:{' '}
              <code className="rounded bg-muted/40 px-1 text-[10.5px]">
                {preview.claude_ai_skill_id.slice(0, 20)}…
              </code>
            </p>
            {preview.claude_ai_last_seen_at && (
              <p>
                Last seen:{' '}
                <time dateTime={preview.claude_ai_last_seen_at}>
                  {timeAgo(preview.claude_ai_last_seen_at)}
                </time>
              </p>
            )}
            <p className="pt-2 text-[11.5px] text-muted-foreground/80">
              The actual claude.ai-side content can’t be fetched from
              here — it lives in the extension’s browser. Check the
              skill directly in claude.ai to compare.
            </p>
          </div>
        </div>
      </div>

      {preview.last_pushed_version_number !== null &&
        preview.current_version_number !== null &&
        preview.last_pushed_version_number !== preview.current_version_number && (
          <p className="text-[11.5px] text-muted-foreground">
            Diff scope: SkillNote moved from v
            {preview.last_pushed_version_number} → v
            {preview.current_version_number} since the last successful push.
          </p>
        )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: string
}) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className={`text-[15px] font-semibold ${tone ?? 'text-foreground'}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
