import { useState, useEffect, useCallback } from 'react'

export function useKeyboardShortcut(
  key: string,
  handler: () => void,
  deps: React.DependencyList = [],
  options?: { ctrl?: boolean; meta?: boolean; ignoreInputs?: boolean }
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      if (options?.ignoreInputs !== false && inInput) return
      if (options?.ctrl && !e.ctrlKey) return
      if (options?.meta && !(e.metaKey || e.ctrlKey)) return

      if (e.key === key) {
        e.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, handler, ...deps])
}

export function useClipboard(timeout = 2000): {
  copied: boolean
  copy: (text: string) => void
} {
  const [copied, setCopied] = useState(false)

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), timeout)
  }, [timeout])

  return { copied, copy }
}

export function useLocalStorage<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue
    const saved = localStorage.getItem(key)
    return saved ? JSON.parse(saved) : defaultValue
  })

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])

  return [value, setValue]
}
