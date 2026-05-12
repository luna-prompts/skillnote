'use client'

import { Download, X } from 'lucide-react'
import { toast } from 'sonner'
import { usePWAInstall } from '@/lib/use-pwa-install'

/**
 * Compact one-time install prompt. Shown only on first eligibility and
 * only if not previously dismissed. Once dismissed, the user can still
 * install from Settings → About or the sidebar footer pill.
 */
export function PWAInstallPrompt() {
  const { canInstall, toastDismissed, install, dismissToast } = usePWAInstall()

  if (!canInstall || toastDismissed) return null

  const handleInstall = async () => {
    const outcome = await install()
    if (outcome === 'accepted') {
      toast.success('SkillNote installed — look for it in your dock')
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Install SkillNote as an app"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-full border border-border/60 bg-card/95 py-1.5 pl-2 pr-1 shadow-md backdrop-blur-sm"
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Download className="h-3 w-3" />
      </div>
      <button
        type="button"
        onClick={handleInstall}
        className="text-[13px] font-medium text-foreground hover:text-accent transition-colors"
      >
        Install SkillNote as an app
      </button>
      <button
        type="button"
        onClick={dismissToast}
        aria-label="Dismiss install prompt"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

export default PWAInstallPrompt
