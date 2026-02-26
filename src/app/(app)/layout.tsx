'use client'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Sidebar } from '@/components/layout/sidebar'
import { ConnectionBanner } from '@/components/layout/connection-banner'
import { BookOpen, FolderOpen, Hash } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SidebarContext } from '@/lib/sidebar-context'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [sidebarOpen])

  return (
    <SidebarContext.Provider value={{ open: sidebarOpen, setOpen: setSidebarOpen }}>
    <div className="flex min-h-screen bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar - hidden on mobile by default */}
      <div className={`sidebar-wrapper fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      <div className="content-wrapper flex-1 ml-0 lg:ml-[220px] flex flex-col min-h-screen overflow-hidden dot-grid pb-16 lg:pb-0">
        <ConnectionBanner />
        {children}
      </div>

      {/* Mobile bottom navigation bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-card border-t border-border/60 flex items-center justify-around lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {[
          { href: '/', icon: BookOpen, label: 'Skills' },
          { href: '/collections', icon: FolderOpen, label: 'Collections' },
          { href: '/tags', icon: Hash, label: 'Tags' },
        ].map(({ href, icon: Icon, label }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2 px-3 min-h-[56px] justify-center transition-all active:scale-95',
                active ? 'text-accent' : 'text-muted-foreground'
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
    </SidebarContext.Provider>
  )
}
