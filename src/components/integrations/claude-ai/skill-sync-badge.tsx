'use client'

// Compact "Synced to claude.ai" badge for the skill detail page header.
// Drives the per-skill toggle (claude_ai_sync_enabled). The badge appears
// only when there's at least one active claude.ai integration — otherwise
// the toggle would be cosmetic.

import { useEffect, useState } from 'react'
import { Cloud, CloudOff } from 'lucide-react'
import { toast } from 'sonner'
import {
  listIntegrations,
  toggleSkillSync,
  type IntegrationStatusResponse,
} from '@/lib/api/claude-ai'

interface Props {
  skillId: string
  /** Initial value from the Skill row. */
  initialEnabled: boolean
  /** Optional callback so the parent can re-sync its local state. */
  onChange?: (enabled: boolean) => void
}

export function SkillSyncBadge({ skillId, initialEnabled, onChange }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [hasIntegrations, setHasIntegrations] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Cheap probe — list integrations once on mount. Cached on the
    // server-side, and the result is small.
    listIntegrations()
      .then((rows: IntegrationStatusResponse[]) =>
        setHasIntegrations(
          rows.some((r) => r.status === 'active' || r.status === 'cookie_expired'),
        ),
      )
      .catch(() => setHasIntegrations(false))
  }, [])

  // Don't render anything until we know if there are integrations.
  if (hasIntegrations === null) return null
  // If no integrations are configured, the toggle would be meaningless.
  if (!hasIntegrations) return null

  const toggle = async () => {
    setBusy(true)
    const next = !enabled
    setEnabled(next) // optimistic
    try {
      await toggleSkillSync(skillId, next)
      onChange?.(next)
      toast.success(next ? 'Sync enabled' : 'Sync disabled for this skill')
    } catch (e) {
      setEnabled(!next) // revert
      toast.error(`Could not update: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const Icon = enabled ? Cloud : CloudOff
  const label = enabled
    ? 'Currently syncing to claude.ai. Click to pause.'
    : 'Currently paused. Click to resume syncing to claude.ai.'
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      className={[
        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30',
        enabled
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
          : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
        busy && 'opacity-60 cursor-not-allowed',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon className={`h-3 w-3 ${busy ? 'animate-pulse' : ''}`} />
      {enabled ? 'Syncing to claude.ai' : 'Sync paused'}
    </button>
  )
}
