'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getApiBaseUrl } from '@/lib/api/client'
import { getSkills } from '@/lib/skills-store'

const ONBOARDED_KEY = 'skillnote:onboarded'

/**
 * One-shot first-run check. On the user's very first session, if there are
 * zero connected agents AND zero local skills, redirect them from `/` to
 * `/integrations` so the activation funnel doesn't start on an empty grid.
 *
 * After the redirect (or on any subsequent session), the `onboarded` flag
 * in localStorage prevents this from running again. The user is in control
 * of their navigation from then on.
 */
export function FirstRunGate() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Already onboarded once — don't auto-redirect again
    try {
      if (window.localStorage.getItem(ONBOARDED_KEY) === '1') return
    } catch {
      return
    }

    // Only fire from the root page — never bounce a user out of a deep link
    if (pathname !== '/') return

    let cancelled = false

    const check = async () => {
      try {
        const apiBase = getApiBaseUrl()
        // R9 F38: check BOTH the API skill list and localStorage. The prior
        // version only checked `getSkills().length` (localStorage), which on
        // a fresh-browser/wiped-cache first paint is always 0. The user got
        // redirected to /integrations even when the API had 8 seeded skills
        // — they should have landed on / and seen those skills. Race window:
        // syncSkillsFromApi() runs after FirstRunGate's effect, so by the
        // time the gate checked localStorage it was still empty.
        const [agentsRes, skillsRes] = await Promise.all([
          fetch(`${apiBase}/v1/setup/agents`, { cache: 'no-store' }),
          fetch(`${apiBase}/v1/skills`, { cache: 'no-store' }),
        ])
        if (!agentsRes.ok || !skillsRes.ok || cancelled) return
        const rows = (await agentsRes.json()) as { state: string }[]
        const apiSkills = (await skillsRes.json()) as unknown[]
        const anyConnected = rows.some((r) => r.state !== 'pending')
        const hasSkills = apiSkills.length > 0 || getSkills().length > 0
        // Mark onboarded regardless of redirect: the gate has done its job.
        // If a user wipes localStorage they'll see it again — that's OK.
        try {
          window.localStorage.setItem(ONBOARDED_KEY, '1')
        } catch {
          // ignore
        }
        if (!anyConnected && !hasSkills && !cancelled) {
          router.replace('/integrations')
        }
      } catch {
        // Backend unreachable on first run — don't redirect, the user can
        // navigate themselves. We DO mark them onboarded so we don't
        // re-trigger on every reload while offline.
        try {
          window.localStorage.setItem(ONBOARDED_KEY, '1')
        } catch {
          // ignore
        }
      }
    }

    check()
    return () => {
      cancelled = true
    }
    // pathname is intentionally the only dependency — we only check once
    // per session, on initial mount with pathname === '/'.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
