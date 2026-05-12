'use client'

import { useEffect, useState } from 'react'

/**
 * Shape of `beforeinstallprompt` (still not in lib.dom — model locally).
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt: () => Promise<void>
}

const DISMISS_KEY = 'skillnote:pwa-install-dismissed'

// Module-level state — the `beforeinstallprompt` event only fires once per
// page load, so we cache it here and let every mounted hook subscribe.
// Without this, the floating prompt would "consume" the event and the
// Settings install row would never light up on the same page load.
let cachedEvent: BeforeInstallPromptEvent | null = null
let installed = false
const subscribers = new Set<() => void>()
let bootstrapped = false

function notify() {
  for (const s of subscribers) s()
}

function bootstrap() {
  if (bootstrapped || typeof window === 'undefined') return
  bootstrapped = true

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    cachedEvent = e as BeforeInstallPromptEvent
    notify()
  })

  window.addEventListener('appinstalled', () => {
    cachedEvent = null
    installed = true
    notify()
  })

  // Detect "already installed" — covers desktop PWA (display-mode: standalone)
  // and the iOS Safari home-screen variant (navigator.standalone).
  try {
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone
    ) {
      installed = true
    }
  } catch {
    // ignore
  }
}

export interface PwaInstallState {
  /** The `beforeinstallprompt` event has fired and the app can be installed. */
  available: boolean
  /** The app is already running as an installed PWA. */
  installed: boolean
  /** The user previously dismissed the floating prompt. */
  dismissed: boolean
  /** Trigger the native install prompt. Resolves after the user's choice. */
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
  /** Mark the floating prompt dismissed for this and future sessions. */
  dismiss: () => void
}

export function usePwaInstall(): PwaInstallState {
  const [, force] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    bootstrap()

    try {
      if (window.localStorage.getItem(DISMISS_KEY) === '1') setDismissed(true)
    } catch {
      // ignore
    }

    const cb = () => force((n) => n + 1)
    subscribers.add(cb)
    return () => {
      subscribers.delete(cb)
    }
  }, [])

  const install = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!cachedEvent) return 'unavailable'
    await cachedEvent.prompt()
    const choice = await cachedEvent.userChoice
    if (choice.outcome === 'accepted') {
      installed = true
    }
    cachedEvent = null
    notify()
    return choice.outcome
  }

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // ignore
    }
    setDismissed(true)
  }

  return {
    available: cachedEvent !== null,
    installed,
    dismissed,
    install,
    dismiss,
  }
}
