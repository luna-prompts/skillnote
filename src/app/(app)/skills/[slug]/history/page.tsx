'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getSkills } from '@/lib/skills-store'

/**
 * R9 F47: `/skills/<slug>/history` was deprecated in favour of `/versions`
 * but kept rendering a dead-end "History has been replaced by Versions."
 * page that the user had to back out of manually. This page now exists
 * solely to redirect — old bookmarks and stale links keep working.
 *
 * The redirect honours a renamed slug from local cache so that
 * `/skills/<old-slug>/history` lands on `/skills/<new-slug>/versions`
 * after a rename instead of 404ing.
 */
export default function SkillHistoryRedirectPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()

  useEffect(() => {
    if (!slug) return
    const local = getSkills().find((s) => s.slug === slug)
    const targetSlug = local?.slug ?? slug
    router.replace(`/skills/${targetSlug}/versions`)
  }, [slug, router])

  // Loading shim; the redirect fires from a client effect so SSR shows this
  // briefly. Matched server + client so no hydration mismatch.
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
      Redirecting…
    </div>
  )
}
