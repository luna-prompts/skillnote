'use client'

import { useState } from 'react'
import { Check, Download } from 'lucide-react'
import { toast } from 'sonner'
import { usePwaInstall } from '@/lib/use-pwa-install'

/**
 * Settings row that surfaces the same "Install as app" affordance the
 * floating prompt does. Visible whenever the browser exposed
 * `beforeinstallprompt`, even if the user previously dismissed the
 * floating prompt — Settings is the durable place to act on it.
 *
 * Three render states:
 *  - already installed → "Installed" with a check.
 *  - install available → primary Install button.
 *  - not available (browser doesn't support / event not fired) → quiet
 *    helper text that links to the docs for manual install via the
 *    browser's address-bar control.
 */
export function InstallAppRow() {
  const { available, installed, install } = usePwaInstall()
  const [busy, setBusy] = useState(false)

  const handleInstall = async () => {
    if (busy) return
    setBusy(true)
    try {
      const outcome = await install()
      if (outcome === 'accepted') toast.success('SkillNote installed')
      else if (outcome === 'unavailable')
        toast.error('Install not available in this browser')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[14px] font-medium text-foreground">
          Install desktop app
        </p>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Run SkillNote in its own window with a dock icon. Same data, no
          browser tab.
        </p>
      </div>

      {installed ? (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-emerald-700 dark:text-emerald-400 font-medium">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
          Installed
        </span>
      ) : available ? (
        <button
          type="button"
          onClick={handleInstall}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                     bg-foreground text-background text-[12.5px] font-medium
                     hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-wait"
        >
          <Download className="h-3.5 w-3.5" />
          Install
        </button>
      ) : (
        <span className="text-[11.5px] text-muted-foreground/80 max-w-[180px] text-right leading-snug">
          Use your browser&rsquo;s install icon in the address bar.
        </span>
      )}
    </div>
  )
}
