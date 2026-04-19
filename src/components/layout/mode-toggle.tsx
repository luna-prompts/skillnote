'use client'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

/**
 * Simple light↔dark toggle — matches the existing TopBar pattern used
 * across Skills / Collections / Settings pages so the control feels
 * native on any surface that mounts it.
 */
export function ModeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <button
      type="button"
      className="h-8 w-8 flex items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle theme"
    >
      <Sun className="h-3.5 w-3.5 dark:hidden" />
      <Moon className="h-3.5 w-3.5 hidden dark:block" />
    </button>
  )
}
