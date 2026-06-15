'use client'

// Top-bar notifications bell — the single place connector events surface.
// Replaces the full-page "Approve browser pairing" interstitial: a pending
// pairing shows here (with its code to verify against the extension) and can
// be approved in place. Also lists recent connector activity (syncs, errors).

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  fetchPendingPairings,
  approvePairing,
  listActivity,
  type PendingPairing,
  type AuditEventOut,
} from '@/lib/api/claude-ai'

// Compact, human labels for the activity line (the full feed lives on the
// connector page; this is a glanceable summary).
const EVENT_LABEL: Record<string, string> = {
  pair_started: 'Pairing started',
  pair_approved: 'Browser paired',
  pair_redeemed: 'Browser connected',
  integration_disconnected: 'Browser disconnected',
  integration_updated: 'Connector updated',
  skill_pushed: 'Synced to claude.ai',
  skill_imported: 'Imported from claude.ai',
  skill_delete_pushed: 'Removed from claude.ai',
  op_failed: 'Sync failed',
  cookie_expired: 'claude.ai session expired',
  conflict_detected: 'Sync conflict',
  conflict_resolved: 'Conflict resolved',
  endpoint_changed: 'claude.ai changed',
  token_revoked: 'Token revoked',
  op_retried: 'Sync retried',
  sync_triggered: 'Sync triggered',
  skill_created: 'Skill created',
  skill_updated: 'Skill updated',
  skill_deleted: 'Skill deleted',
  skill_restored: 'Skill restored',
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// localStorage key for the unread watermark — events newer than this count
// toward the badge, like any mail/notification UI. Persisted so a reload
// doesn't resurrect already-seen notifications.
const SEEN_KEY = 'skillnote:notifications-seen-at'

export function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<PendingPairing[]>([])
  const [activity, setActivity] = useState<AuditEventOut[]>([])
  const [unread, setUnread] = useState(0)
  const [approving, setApproving] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  // Track the prior pending count so a NEW request auto-opens the dropdown
  // (surfacing it like a popup) rather than just bumping the badge.
  const prevPending = useRef(0)
  // Pairing ids the user dismissed this session — kept hidden so a still-
  // pending request doesn't reappear (and re-pop) on the next 8s poll.
  const dismissed = useRef<Set<string>>(new Set())
  // Unread watermark (ms epoch). Reading localStorage lazily keeps SSR happy.
  const seenAt = useRef<number>(0)
  useEffect(() => {
    seenAt.current = Number(localStorage.getItem(SEEN_KEY) ?? 0)
  }, [])

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([
      fetchPendingPairings().catch(() => [] as PendingPairing[]),
      listActivity({ limit: 20 }).catch(() => [] as AuditEventOut[]),
    ])
    const visible = p.filter((x) => !dismissed.current.has(x.integration_id))
    setPending(visible)
    setActivity(a.slice(0, 6))
    setUnread(a.filter((ev) => new Date(ev.created_at).getTime() > seenAt.current).length)
    // A new (non-dismissed) request appeared → pop the dropdown open.
    if (visible.length > prevPending.current) setOpen(true)
    prevPending.current = visible.length
  }, [])

  // Opening the panel marks everything seen — the badge clears, matching the
  // convention every notification UI follows.
  const markSeen = useCallback(() => {
    seenAt.current = Date.now()
    localStorage.setItem(SEEN_KEY, String(seenAt.current))
    setUnread(0)
  }, [])
  useEffect(() => {
    if (open) markSeen()
  }, [open, markSeen])

  // Poll while the tab is visible (pending pairings are time-sensitive).
  useEffect(() => {
    void load()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 8000)
    return () => clearInterval(id)
  }, [load])

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const approve = async (p: PendingPairing) => {
    setApproving(p.integration_id)
    try {
      await approvePairing(p.pairing_code)
      toast.success('Browser paired — syncing to claude.ai')
      setPending((prev) => prev.filter((x) => x.integration_id !== p.integration_id))
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not approve pairing')
    } finally {
      setApproving(null)
    }
  }

  const dismiss = (id: string) => {
    dismissed.current.add(id) // keep dismissed across polls (no re-nag)
    setPending((prev) => prev.filter((x) => x.integration_id !== id))
  }

  // Badge = actionable pairings + unread events. Pairings always count (they
  // need a decision); reads clear once the panel opens.
  const badge = pending.length + unread

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={badge > 0 ? `Notifications (${badge} unread)` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Bell className="h-[18px] w-[18px]" />
        {badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-background tabular-nums">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-xl border border-border bg-card shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="px-4 py-2.5 border-b border-border/60">
            <span className="text-[13px] font-semibold text-foreground">Notifications</span>
          </div>

          {/* Pending pairing requests — actionable, approve in place. */}
          {pending.length > 0 && (
            <div className="border-b border-border/60 bg-accent/[0.03]">
              {pending.map((p) => (
                <div key={p.integration_id} className="px-4 py-3">
                  <p className="text-[12.5px] font-medium text-foreground">Browser wants to pair</p>
                  <p className="text-[11px] text-muted-foreground/80 mt-0.5 leading-snug">
                    {p.browser_label || 'A browser'} — approve only if the code matches your SkillNote extension.
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-[14px] tracking-[0.18em] text-foreground bg-muted/60 rounded px-2 py-1">
                      {p.pairing_code}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => dismiss(p.integration_id)}
                        className="h-7 px-2.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={() => void approve(p)}
                        disabled={approving === p.integration_id}
                        className="h-7 px-3 rounded-md text-[12px] font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-60 flex items-center gap-1.5 transition-colors"
                      >
                        {approving === p.integration_id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        Approve
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recent connector activity. */}
          <div className="max-h-72 overflow-auto">
            {activity.length === 0 ? (
              pending.length === 0 ? (
                <div className="px-4 py-8 text-center text-[12px] text-muted-foreground/60">
                  Nothing yet — skill changes, syncs, and pairings show up here.
                </div>
              ) : null
            ) : (
              activity.map((ev) => (
                <div
                  key={ev.id}
                  className="px-4 py-2 flex items-center justify-between gap-3 hover:bg-muted/20"
                >
                  <span className="text-[12px] text-foreground truncate">
                    {EVENT_LABEL[ev.event] ?? ev.event}
                    {ev.skill_slug ? (
                      <span className="text-muted-foreground/70"> · {ev.skill_slug}</span>
                    ) : null}
                  </span>
                  <span className="text-[11px] text-muted-foreground/50 shrink-0 tabular-nums">
                    {timeAgo(ev.created_at)}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* The bell is short-lived/quick; the full history lives here. */}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 border-t border-border/60 text-center text-[12px] font-medium text-accent hover:bg-muted/30 transition-colors"
          >
            View all notifications
          </Link>
        </div>
      )}
    </div>
  )
}
