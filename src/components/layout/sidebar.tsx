'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, FolderOpen, Settings, HelpCircle, X, Plug2, BarChart2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useMemo, useState } from 'react'
import { getSkills, syncSkillsFromApi, getConnectionStatus, onConnectionStatusChange } from '@/lib/skills-store'

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname()
  const [skills, setSkills] = useState<Array<ReturnType<typeof getSkills>[number]>>([])
  const [connStatus, setConnStatus] = useState(getConnectionStatus())

  useEffect(() => {
    setSkills(getSkills())
    syncSkillsFromApi().then(setSkills).catch(() => {})
    return onConnectionStatusChange(setConnStatus)
  }, [])

  const navItems = useMemo(() => {
    const collectionSet = new Set<string>()
    for (const s of skills) {
      ;(s.collections || []).forEach(c => collectionSet.add(c))
    }
    return [
      { href: '/', label: 'Skills', icon: BookOpen, count: skills.length },
      { href: '/collections', label: 'Collections', icon: FolderOpen, count: collectionSet.size },
    ]
  }, [skills])

  return (
    <aside className="w-[220px] h-screen flex flex-col bg-[var(--sidebar)] border-r border-[var(--sidebar-border)]">
      {/* Logo */}
      <div className="h-14 px-4 flex items-center gap-2.5 border-b border-[var(--sidebar-border)]">
        <img src="/icon.svg" alt="SkillNote" className="w-7 h-7 rounded-lg shrink-0 border border-[var(--sidebar-border)]" />
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-[var(--sidebar-foreground)] tracking-tight leading-tight">SkillNote</span>
          <span className="text-[9px] text-[var(--muted-foreground)]/40 tracking-wide leading-tight">by Luna Prompts</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="ml-auto p-1 rounded-md text-[var(--muted-foreground)] hover:text-[var(--sidebar-foreground)] lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Close sidebar">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto sidebar-gradient">
        <p className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest px-2 mb-2">Workspace</p>
        {navItems.map(({ href, label, icon: Icon, count }) => {
          const isActive = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium transition-all duration-150',
                isActive
                  ? 'bg-accent/12 text-accent border-l-2 border-accent -ml-px'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]'
              )}
            >
              <Icon className={cn('h-[15px] w-[15px] shrink-0', isActive ? 'text-accent' : '')} />
              {label}
              <span className={cn(
                'ml-auto text-[11px] tabular-nums',
                isActive ? 'text-accent/70' : 'text-[var(--muted-foreground)]/50'
              )}>
                {count}
              </span>
            </Link>
          )
        })}

        {/* Connect section */}
        <div className="pt-3 mt-1.5 border-t border-[var(--sidebar-border)]/40">
          <p className="text-[10px] font-semibold text-[var(--muted-foreground)]/50 uppercase tracking-widest px-2 mb-2">Connect</p>
          {(() => {
            const isActive = pathname.startsWith('/analytics')
            return (
              <Link
                href="/analytics"
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium transition-all duration-150',
                  isActive
                    ? 'bg-accent/12 text-accent border-l-2 border-accent -ml-px'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]'
                )}
              >
                <BarChart2 className={cn('h-[15px] w-[15px] shrink-0', isActive ? 'text-accent' : '')} />
                Analytics
              </Link>
            )
          })()}
          {(() => {
            const isActive = pathname.startsWith('/integrations')
            return (
              <Link
                href="/integrations"
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium transition-all duration-150',
                  isActive
                    ? 'bg-accent/12 text-accent border-l-2 border-accent -ml-px'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]'
                )}
              >
                <Plug2 className={cn('h-[15px] w-[15px] shrink-0', isActive ? 'text-accent' : '')} />
                MCP Integrations
              </Link>
            )
          })()}
        </div>
      </nav>

      {/* Footer */}
      <div className="px-2 py-2 border-t border-[var(--sidebar-border)] space-y-0.5">
        <Link href="/settings" aria-label="Settings" className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium text-[var(--muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] transition-all duration-150">
          <Settings className="h-[15px] w-[15px] shrink-0" />
          Settings
        </Link>
        <a
          href="https://github.com/luna-prompts/skillnote#readme"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Help"
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium text-[var(--muted-foreground)] hover:text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)] transition-all duration-150"
        >
          <HelpCircle className="h-[15px] w-[15px] shrink-0" />
          Help
        </a>
        <div className="flex items-center gap-1.5 px-2.5 pt-2" title={connStatus === 'online' ? 'Connected to backend' : connStatus === 'offline' ? 'Backend offline' : 'Running locally'}>
          <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', connStatus === 'online' ? 'bg-emerald-500' : connStatus === 'offline' ? 'bg-red-500' : 'bg-teal-500')} />
          <p className="text-[10px] text-[var(--muted-foreground)]/40">
            {connStatus === 'online' ? 'Connected' : connStatus === 'offline' ? 'Offline' : 'Admin'}
          </p>
        </div>
      </div>
    </aside>
  )
}
