'use client'

import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePwaInstall } from '@/lib/use-pwa-install'

/**
 * Floating install prompt — shown bottom-right (desktop) / bottom-center
 * (mobile) when the browser surfaces `beforeinstallprompt`. Reuses the
 * shared `usePwaInstall` hook so the Settings install row sees the same
 * event and stays in sync after dismissal/install.
 */
export function PWAInstallPrompt() {
  const { available, installed, dismissed, install, dismiss } = usePwaInstall()

  if (installed || dismissed || !available) return null

  const handleInstall = async () => {
    const outcome = await install()
    if (outcome === 'dismissed') dismiss()
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
