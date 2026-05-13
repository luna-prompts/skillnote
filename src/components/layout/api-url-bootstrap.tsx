'use client'

import { useEffect } from 'react'

const STORAGE_KEY = 'skillnote:api-url'
const PARAM = 'api'

/**
 * Reads `?api=<url>` from the current URL on mount, writes it to localStorage,
 * and strips the query param. This is the workaround for R9 F28: the
 * `NEXT_PUBLIC_API_BASE_URL` is baked into the Next.js bundle at IMAGE BUILD
 * time, so users who run `npx skillnote start --api-port <X>` get a browser
 * bundle that still points at the default `localhost:8082`. The CLI can now
 * emit a URL like `http://localhost:3000/?api=http://localhost:8092` and this
 * component persists the override on first paint, before any API call fires.
 *
 * Safety:
 *  - Only writes the param if it's a syntactically-valid http(s) URL.
 *  - Refuses to write a URL whose origin isn't reachable on a typical
 *    self-host shape: localhost, 127.0.0.1, or the same host the page
 *    was served from. This prevents a phishing-style query-string attack
 *    that points the UI at an attacker-controlled API endpoint.
 *  - Strips the query param after persisting so a bookmark / share-link
 *    of the post-bootstrap URL doesn't keep re-applying the override.
 */
export function ApiUrlBootstrap() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const url = new URL(window.location.href)
      const raw = url.searchParams.get(PARAM)
      if (!raw) return

      let candidate: URL
      try {
        candidate = new URL(raw)
      } catch {
        // Malformed — drop the param silently. Don't poison localStorage.
        url.searchParams.delete(PARAM)
        window.history.replaceState({}, '', url.toString())
        return
      }

      const allowed =
        candidate.protocol === 'http:' || candidate.protocol === 'https:'
      const sameHostFamily =
        candidate.hostname === 'localhost' ||
        candidate.hostname === '127.0.0.1' ||
        candidate.hostname === window.location.hostname
      if (allowed && sameHostFamily) {
        window.localStorage.setItem(STORAGE_KEY, candidate.origin)
      }
      url.searchParams.delete(PARAM)
      window.history.replaceState({}, '', url.toString())
    } catch {
      // localStorage blocked or URL parsing failed — fall back to whatever
      // resolution path was in effect before. No spam.
    }
  }, [])

  return null
}
