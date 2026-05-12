'use client'

import { Check, Download } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { usePWAInstall } from '@/lib/use-pwa-install'

interface Props {
  variant?: 'inline' | 'pill'
  className?: string
}

/**
 * Renders an install affordance the user can keep using even after they
 * dismissed the auto-toast. Hidden entirely if the browser hasn't fired
 * `beforeinstallprompt` yet (most often: Safari, or Chrome before the
 * eligibility heuristic fires), or if the app is already installed.
 *
 * `variant="inline"` — for the Settings page (button-style).
 * `variant="pill"` — for the sidebar footer (tiny dimmed pill).
 */
export function PWAInstallButton({ variant = 'inline', className }: Props) {
  const { canInstall, isInstalled, install } = usePWAInstall()

  // Already installed: show a subtle confirmation in the settings layout,
  // hide entirely in the sidebar pill (no need to nag users with "installed").
  if (isInstalled) {
    if (variant === 'pill') return null
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-[12px] text-muted-foreground',
          className,
        )}
      >
        <Check className="h-3 w-3 text-emerald-500" />
        Installed as desktop app
      </span>
    )
  }

  if (!canInstall) return null

  const handleClick = async () => {
    const outcome = await install()
    if (outcome === 'accepted') {
      toast.success('SkillNote installed — look for it in your dock')
    }
  }

  if (variant === 'pill') {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-accent transition-colors',
          className,
        )}
      >
        <Download className="h-2.5 w-2.5" />
        Install app
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-background text-[13px] font-medium text-foreground hover:bg-muted hover:border-accent/40 transition-colors',
        className,
      )}
    >
      <Download className="h-3.5 w-3.5" />
      Install as desktop app
    </button>
  )
}
