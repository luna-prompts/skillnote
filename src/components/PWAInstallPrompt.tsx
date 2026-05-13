'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { usePwaInstall } from '@/lib/use-pwa-install'

const VISIT_COUNT_KEY = 'skillnote:visit-count'
/**
 * Minimum number of distinct page loads before the install prompt is allowed
 * to surface. R9 F30: showing on the very first visit is poor UX (industry
 * guidance — Lighthouse PWA criteria, MDN install patterns). The user gets
 * a sniff of the product first; only on visit #2+ do we suggest installing.
 */
const MIN_VISITS_BEFORE_PROMPT = 2

/**
 * Floating install prompt — shown bottom-right (desktop) / bottom-center
 * (mobile) when the browser surfaces `beforeinstallprompt`. Reuses the
 * shared `usePwaInstall` hook so the Settings install row sees the same
 * event and stays in sync after dismissal/install.
 *
 * R9 F30 — only surfaces from the user's 2nd visit onward.
 * R9 F29 — when the captured event has been consumed (or the browser is
 *          one that never surfaces `beforeinstallprompt` like Firefox/Safari),
 *          clicking Install now dismisses + shows a fallback toast pointing
 *          at the browser's Install menu instead of silently doing nothing.
 */
export function PWAInstallPrompt() {
  const { available, installed, dismissed, install, dismiss } = usePwaInstall()
  const [visitsOk, setVisitsOk] = useState(false)
  // React Strict Mode runs effects twice in dev (mount → unmount → mount),
  // which would double-increment our visit counter. Guard with a ref so
  // each mounted instance only counts once.
  const incrementedRef = useRef(false)

  useEffect(() => {
    if (incrementedRef.current) return
    incrementedRef.current = true
    try {
      const prev = Number(window.localStorage.getItem(VISIT_COUNT_KEY) ?? '0') || 0
      const next = prev + 1
      window.localStorage.setItem(VISIT_COUNT_KEY, String(next))
      setVisitsOk(next >= MIN_VISITS_BEFORE_PROMPT)
    } catch {
      // Storage blocked (Safari private mode etc.) — fail closed: never
      // show the prompt rather than spamming someone who can't dismiss it.
    }
  }, [])

  if (installed || dismissed || !available || !visitsOk) return null

  const handleInstall = async () => {
    const outcome = await install()
    if (outcome === 'dismissed') {
      dismiss()
    } else if (outcome === 'unavailable') {
      // R9 F29: cachedEvent went null between render and click. Tell the
      // user how to install via the browser's own menu and dismiss the
      // prompt so it doesn't keep failing.
      toast.message('Install via your browser', {
        description:
          "Use your browser's address-bar Install button, or open the menu and choose “Install SkillNote”.",
      })
      dismiss()
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Install SkillNote as an app"
      className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-md rounded-xl border border-border bg-card p-4 shadow-lg lg:bottom-6 lg:left-auto lg:right-6"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
          <Download className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Install SkillNote as an app</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Get a dock icon and chromeless window. Same data, no browser tab.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={handleInstall}>
              Install
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="-mr-1 -mt-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export default PWAInstallPrompt
