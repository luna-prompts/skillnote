'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { ActivityFeed } from '@/components/integrations/claude-ai/activity-feed'

export default function ClaudeAIActivityPage() {
  // Keyboard shortcut: `/` focuses the search box (Linear-style).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        const input = document.getElementById('activity-search') as HTMLInputElement | null
        if (input) {
          e.preventDefault()
          input.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <TopBar />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-3 text-[12px] text-muted-foreground">
          <Link href="/settings" className="hover:text-foreground">
            Settings
          </Link>
          <span className="mx-1.5">/</span>
          <Link href="/settings/integrations/claude-ai" className="hover:text-foreground">
            claude.ai
          </Link>
          <span className="mx-1.5">/</span>
          <span>Activity</span>
        </div>

        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/settings/integrations/claude-ai"
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Link>
        </div>

        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
              Activity
            </h1>
            <p className="mt-1 text-[14px] text-muted-foreground">
              Every event from the claude.ai connector — pairings, syncs, conflicts, errors.
            </p>
          </div>
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            <span>/</span> to search
          </kbd>
        </div>

        <div className="mt-8">
          <ActivityFeed pageSize={100} />
        </div>
      </div>
    </>
  )
}
