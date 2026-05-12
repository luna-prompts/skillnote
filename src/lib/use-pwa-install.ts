'use client'

import { useCallback, useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt: () => Promise<void>
}

const TOAST_DISMISS_KEY = 'skillnote:pwa-install-dismissed'

interface UsePWAInstall {
  canInstall: boolean
  isInstalled: boolean
  toastDismissed: boolean
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
  dismissToast: () => void
}

/**
 * Shared PWA install state. One subscriber catches `beforeinstallprompt`;
 * any number of UI surfaces (toast, settings row, sidebar pill) can render
 * an install affordance backed by the same prompt event.
 *
 * `canInstall` flips to false once the event is consumed or the app is
 * installed. Dismissing the toast only hides the *toast* — the settings
 * and sidebar paths stay available so the user can change their mind.
 */
export function usePWAInstall(): UsePWAInstall {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [toastDismissed, setToastDismissed] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return

    setIsInstalled(window.matchMedia('(display-mode: standalone)').matches)

    try {
      setToastDismissed(window.localStorage.getItem(TOAST_DISMISS_KEY) === '1')
    } catch {
      // localStorage unavailable — keep toastDismissed=true so we don't flash
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
    }
    const onAppInstalled = () => {
      setIsInstalled(true)
      setPromptEvent(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!promptEvent) return 'unavailable'
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    if (choice.outcome === 'accepted') {
      setPromptEvent(null)
      setIsInstalled(true)
    }
    return choice.outcome
  }, [promptEvent])

  const dismissToast = useCallback(() => {
    try {
      window.localStorage.setItem(TOAST_DISMISS_KEY, '1')
    } catch {
      // ignore
    }
    setToastDismissed(true)
  }, [])

  return {
    canInstall: !isInstalled && promptEvent !== null,
    isInstalled,
    toastDismissed,
    install,
    dismissToast,
  }
}
