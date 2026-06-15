'use client'

import Link from 'next/link'
import { Sparkles, ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchCollectionsApi } from '@/lib/api/collections'

/**
 * Light status line for the connector page: how many collections are published
 * to claude.ai as named plugin groups, with a deep-link to manage them. The
 * actual per-collection toggle lives ON the collection card (in /collections) —
 * this keeps the connector page a thin status view, not a curation panel.
 */
export function PublishedCollectionsSummary() {
  const [published, setPublished] = useState<number | null>(null)
  const [skills, setSkills] = useState(0)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => {
      fetchCollectionsApi()
        .then((cols) => {
          if (!alive) return
          const pub = cols.filter((c) => c.published_to_claude_ai)
          setPublished(pub.length)
          setSkills(pub.reduce((n, c) => n + (c.count || 0), 0))
          setError(false)
        })
        .catch(() => {
          // Keep the last good counts on a failed poll; only the never-loaded
          // case shows an error (so error ≠ the neutral loading state).
          if (alive) setError(true)
        })
    }
    load()
    // Poll while visible so the count tracks toggles made elsewhere (every
    // sibling panel on this page polls). Also refresh on focus. Pause hidden.
    const onFocus = () => {
      if (document.visibilityState === 'visible') load()
    }
    const timer = setInterval(onFocus, 30000)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])

  return (
    <Link
      href="/collections"
      className="group flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card px-4 py-3 transition-colors hover:border-border"
    >
      <span className="flex items-center gap-2.5 text-[13px] text-foreground">
        <Sparkles className="h-4 w-4 text-accent shrink-0" />
        {published === null && error ? (
          <span className="text-muted-foreground">Couldn’t load published collections</span>
        ) : published === null ? (
          <span className="text-muted-foreground">Loading…</span>
        ) : published === 0 ? (
          <span>
            <span className="font-medium">No collections published yet</span>
            <span className="text-muted-foreground"> — pick collections to show in claude.ai</span>
          </span>
        ) : (
          <span>
            <span className="font-medium tabular-nums">{published}</span>
            {` collection${published === 1 ? '' : 's'} live in claude.ai`}
            <span className="text-muted-foreground tabular-nums">{` · ${skills} skill${skills === 1 ? '' : 's'}`}</span>
          </span>
        )}
      </span>
      <span className="flex items-center gap-1 text-[12px] text-muted-foreground group-hover:text-foreground">
        Manage
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}
