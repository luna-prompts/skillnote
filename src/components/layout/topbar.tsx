'use client'
import { useState, useRef, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, Upload, Plus, LayoutList, LayoutGrid, Moon, Sun, ChevronRight, X, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import { getSkills, syncSkillsFromApi } from '@/lib/skills-store'
import { useSidebar } from '@/lib/sidebar-context'
import { ImportModal } from '@/components/import/ImportModal'

type TopBarProps = {
  view?: 'list' | 'grid'
  onViewChange?: (v: 'list' | 'grid') => void
  showViewToggle?: boolean
  searchQuery?: string
  onSearchChange?: (query: string) => void
  showFab?: boolean
}

function Breadcrumbs() {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const segments = pathname.split('/').filter(Boolean)

  const crumbs: { label: string; href?: string }[] = []

  if (segments.length === 0) {
    crumbs.push({ label: 'Skills' })
  } else if (segments[0] === 'skills' && segments[1]) {
    crumbs.push({ label: 'Skills', href: '/' })
    // Only read localStorage after mount to avoid hydration mismatch
    const skill = mounted ? getSkills().find(s => s.slug === segments[1]) : undefined
    crumbs.push({ label: skill?.title ?? segments[1] })
  } else if (segments[0] === 'collections' && segments[1]) {
    crumbs.push({ label: 'Collections', href: '/collections' })
    const label = decodeURIComponent(segments[1]).replace(/-/g, ' ')
    crumbs.push({ label })
  } else if (segments[0] === 'collections') {
    crumbs.push({ label: 'Collections' })
  } else if (segments[0] === 'tags') {
    crumbs.push({ label: 'Tags' })
  }

  return (
    <div className="flex items-center gap-1 text-[12px] mr-3 min-w-0">
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
          {crumb.href ? (
            <Link href={crumb.href} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
              {crumb.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium truncate max-w-[120px] sm:max-w-[200px]">{crumb.label}</span>
          )}
        </span>
      ))}
    </div>
  )
}

export function TopBar({ view = 'list', onViewChange, showViewToggle = false, searchQuery = '', onSearchChange, showFab = true }: TopBarProps) {
  const { theme, setTheme } = useTheme()
  const { setOpen: setSidebarOpen } = useSidebar()
  const searchRef = useRef<HTMLInputElement>(null)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        searchRef.current?.blur()
        setMobileSearchOpen(false)
      }
      const inInput = ['INPUT', 'TEXTAREA'].includes((e.target as Element).tagName) ||
        (e.target as Element).hasAttribute('contenteditable')
      if (e.key === 'n' && !inInput && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        router.push('/skills/new')
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return (
    <>
      <header className="h-14 border-b border-border/60 bg-card/80 backdrop-blur-sm flex items-center pl-3 pr-3 lg:pl-5 sm:pr-5 gap-2 sm:gap-3 sticky top-0 z-10">
        {/* Mobile hamburger — inside header, first item */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
          aria-label="Open sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Mobile search expanded */}
        {mobileSearchOpen ? (
          <div className="flex-1 flex items-center gap-2 lg:hidden">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-[14px] w-[14px] text-muted-foreground pointer-events-none" />
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={e => onSearchChange?.(e.target.value)}
                className="w-full pl-8 pr-4 py-1.5 text-[13px] bg-muted/60 rounded-lg border border-border/60 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/70 transition-all"
                placeholder="Search skills..."
                autoFocus
              />
            </div>
            <button onClick={() => setMobileSearchOpen(false)} className="p-2 text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Close search">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <Breadcrumbs />

            {/* Desktop search */}
            <div className="flex-1 max-w-sm relative hidden lg:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-[14px] w-[14px] text-muted-foreground pointer-events-none" />
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={e => onSearchChange?.(e.target.value)}
                className="w-full pl-8 pr-10 py-1.5 text-[13px] bg-muted/60 rounded-lg border border-border/60 focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring placeholder:text-muted-foreground/70 transition-all"
                placeholder="Search skills..."
              />
              <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50 font-mono hidden sm:block">⌘K</kbd>
            </div>

            {/* Mobile search icon */}
            <button
              onClick={() => setMobileSearchOpen(true)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Search"
            >
              <Search className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-1.5 ml-auto">
              {showViewToggle && (
                <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
                  <button
                    onClick={() => onViewChange?.('list')}
                    className={cn('p-1.5 rounded-md transition-all', view === 'list' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
                    title="List view"
                    aria-label="List view"
                  >
                    <LayoutList className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onViewChange?.('grid')}
                    className={cn('p-1.5 rounded-md transition-all', view === 'grid' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
                    title="Grid view"
                    aria-label="Grid view"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Import - hidden on mobile */}
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[13px] font-medium border-border/60 hidden lg:flex" onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5" />
                Import
              </Button>

              {/* New Skill - hidden on mobile (becomes FAB) */}
              <Button size="sm" className="h-8 gap-1.5 text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90 border-0 hidden lg:flex" onClick={() => router.push('/skills/new')}>
                <Plus className="h-3.5 w-3.5" />
                New Skill
              </Button>

              <button
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label="Toggle theme"
              >
                <Sun className="h-3.5 w-3.5 dark:hidden" />
                <Moon className="h-3.5 w-3.5 hidden dark:block" />
              </button>
            </div>
          </>
        )}
      </header>

      {/* Mobile FAB — New Skill */}
      {showFab && (
        <button
          className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] right-6 z-40 w-14 h-14 rounded-full bg-accent text-white shadow-lg hover:bg-accent/90 active:scale-95 flex items-center justify-center transition-all lg:hidden"
          aria-label="New Skill"
          onClick={() => router.push('/skills/new')}
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={() => router.refresh()}
        />
      )}
    </>
  )
}
