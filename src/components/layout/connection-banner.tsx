'use client'
import { useEffect, useState } from 'react'
import { WifiOff, X, RefreshCw } from 'lucide-react'
import { getConnectionStatus, onConnectionStatusChange, syncSkillsFromApi } from '@/lib/skills-store'

export function ConnectionBanner() {
  const [status, setStatus] = useState(getConnectionStatus())
  const [dismissed, setDismissed] = useState(false)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    return onConnectionStatusChange(setStatus)
  }, [])

  async function handleRetry() {
    setRetrying(true)
    await syncSkillsFromApi()
    setRetrying(false)
  }

  // Only render on a CONFIRMED failed sync. The initial page-load state is
  // 'checking' (first sync still in flight) — rendering anything there made a
  // scary "backend unreachable" banner flash on every single load.
  if (dismissed || status !== 'offline') return null

  return (
    // R9 F50: `role="status"` + `aria-live="polite"` so screen readers
    // announce when the backend goes offline without interrupting the user
    // mid-action. `alert` would be too aggressive for "you might want to
    // know" connectivity changes.
    <div
      role="status"
      aria-live="polite"
      aria-label="Backend connection status"
      className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center gap-2 text-[12px] text-amber-800 dark:text-amber-300"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">
        Can&apos;t reach the SkillNote server — your work is saved on this device and syncs when it&apos;s back.
      </span>
      <button
        onClick={handleRetry}
        disabled={retrying}
        className="flex items-center gap-1 px-2 py-0.5 rounded border border-amber-500/40 hover:bg-amber-500/10 disabled:opacity-50 transition-colors"
      >
        <RefreshCw className={`h-2.5 w-2.5 ${retrying ? 'animate-spin' : ''}`} />
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss connection banner"
        className="p-0.5 hover:opacity-70"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
