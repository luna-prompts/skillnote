'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { X, Check, Copy, Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'

type OS = 'unix' | 'windows'

const AGENT = {
  id: 'claude-code',
  label: 'Claude Code',
  dir: (s: string) => `.claude/skills/skillnote-${s}`,
}

const OS_TABS: { id: OS; label: string }[] = [
  { id: 'unix', label: 'macOS / Linux' },
  { id: 'windows', label: 'Windows' },
]

function buildCommand(slug: string, os: OS, apiBase: string): string {
  const relDir = AGENT.dir(slug)

  if (os === 'windows') {
    const winDir = relDir.replace(/\//g, '\\')
    const dest = `%USERPROFILE%\\${winDir}`
    return `mkdir "${dest}" 2>nul & curl -sL ${apiBase}/v1/skills/${slug}/raw -o "${dest}\\SKILL.md"`
  }

  // macOS / Linux
  const dest = `$HOME/${relDir}`
  return `mkdir -p ${dest} && curl -sL ${apiBase}/v1/skills/${slug}/raw -o ${dest}/SKILL.md`
}

function displayPath(slug: string, os: OS): string {
  const relDir = AGENT.dir(slug)
  if (os === 'windows') {
    return `%USERPROFILE%\\${relDir.replace(/\//g, '\\')}\\SKILL.md`
  }
  return `~/${relDir}/SKILL.md`
}

export function InstallDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [selectedOS, setSelectedOS] = useState<OS>('unix')
  const [copied, setCopied] = useState(false)

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8082'
  const command = buildCommand(slug, selectedOS, apiBase)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-in fade-in duration-150" onClick={onClose}>
      <div className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Install to Claude Code</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted/50" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* OS tabs + Command */}
        <div className="px-5 pt-4 pb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">Paste in your terminal</p>
            <div className="flex gap-1 bg-muted/40 rounded-md p-0.5">
              {OS_TABS.map(os => (
                <button
                  key={os.id}
                  onClick={() => { setSelectedOS(os.id); setCopied(false) }}
                  className={cn(
                    'px-2 py-1 rounded text-[11px] font-medium transition-colors',
                    selectedOS === os.id
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {os.label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative group">
            <pre className="bg-muted/50 border border-border/60 rounded-lg px-4 py-3 pr-12 text-[12px] font-mono text-foreground/90 leading-relaxed overflow-x-auto whitespace-pre-wrap break-all select-all">
              {command}
            </pre>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'absolute top-2 right-2 h-7 w-7 p-0 transition-colors',
                copied ? 'text-emerald-500' : 'text-muted-foreground opacity-0 group-hover:opacity-100'
              )}
              onClick={handleCopy}
              aria-label="Copy command"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border/60 bg-muted/20 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground/50">
            Installs to <code className="font-mono text-[10px]">{displayPath(slug, selectedOS)}</code>
          </p>
          <Button size="sm" className="h-8 text-[13px] gap-1.5" onClick={handleCopy}>
            {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy Command</>}
          </Button>
        </div>
      </div>
    </div>
  )
}
