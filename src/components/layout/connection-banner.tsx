'use client'
import { useEffect, useState } from 'react'
import { WifiOff, Settings2, X, RefreshCw } from 'lucide-react'
import Link from 'next/link'
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

  if (dismissed || status === 'online') return null

  if (status === 'unconfigured') {
    return (
      <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center gap-2 text-[12px] text-amber-700 dark:text-amber-400">
        <Settings2 className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Backend not configured. <Link href="/settings" className="underline font-medium">Add your API token in Settings</Link> to sync skills.</span>
        <button onClick={() => setDismissed(true)} className="p-0.5 hover:opacity-70"><X className="h-3 w-3" /></button>
      </div>
    )
  }

  if (status === 'offline') {
    return (
      <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 flex items-center gap-2 text-[12px] text-red-700 dark:text-red-400">
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Backend unreachable — showing cached data.</span>
        <button
          onClick={handleRetry}
          disabled={retrying}
          className="flex items-center gap-1 px-2 py-0.5 rounded border border-red-400/40 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`h-2.5 w-2.5 ${retrying ? 'animate-spin' : ''}`} />
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
        <button onClick={() => setDismissed(true)} className="p-0.5 hover:opacity-70"><X className="h-3 w-3" /></button>
      </div>
    )
  }

  return null
}
