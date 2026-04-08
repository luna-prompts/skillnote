'use client'
import { useState, useCallback } from 'react'
import { Check, Copy, ExternalLink, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type OS = 'unix' | 'win'

const AGENT = {
  id: 'claude-code',
  label: 'Claude Code',
  dir: (s: string) => `.claude/skills/skillnote-${s}`,
  url: 'https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview',
}

function buildCmd(slug: string, os: OS, apiBase: string): string {
  if (os === 'win') {
    const winDir = AGENT.dir(slug).replace(/\//g, '\\')
    const dest = `%USERPROFILE%\\${winDir}`
    return `mkdir "${dest}" 2>nul & curl -sL ${apiBase}/v1/skills/${slug}/raw -o "${dest}\\SKILL.md"`
  }
  const dest = `$HOME/${AGENT.dir(slug)}`
  return `mkdir -p ${dest} && curl -sL ${apiBase}/v1/skills/${slug}/raw -o ${dest}/SKILL.md`
}

function displayPath(slug: string, os: OS): string {
  if (os === 'win') return `%USERPROFILE%\\${AGENT.dir(slug).replace(/\//g, '\\')}\\SKILL.md`
  return `~/${AGENT.dir(slug)}/SKILL.md`
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  return new Promise((resolve) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    resolve()
  })
}

export function InstallStrip({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false)
  const [os, setOs] = useState<OS>('unix')
  const [copied, setCopied] = useState(false)
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8082'

  const handleCopy = useCallback(async (text: string) => {
    await copyText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])

  return (
    <>
      <div>
        <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/40 font-medium mb-3">Install to</p>

        <div className="font-mono text-[12px] leading-none">
          <button
            onClick={() => setOpen(true)}
            className={cn(
              'w-full text-left py-[7px] pr-2 rounded-[4px] transition-colors duration-100',
              'hover:bg-muted/50',
              open && 'bg-muted/60'
            )}
          >
            <span className="text-muted-foreground/25 select-none">{'└── '}</span>
            <span className={cn(
              'transition-colors',
              open ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}>
              {AGENT.label}
            </span>
          </button>
        </div>
      </div>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-in fade-in duration-150"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg mx-4 bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
              <div className="flex items-center gap-3">
                <span className="text-[14px] font-semibold text-foreground">{AGENT.label}</span>
                <a
                  href={AGENT.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors"
                >
                  docs <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-muted/50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* OS toggle + command */}
            <div className="px-5 pt-4 pb-3">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/50 font-medium">Paste in your terminal</p>
                <div className="flex bg-muted/60 rounded-lg p-[3px] gap-[2px]">
                  {([['unix', 'macOS / Linux'], ['win', 'Windows']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => { setOs(id); setCopied(false) }}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150',
                        os === id
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground/60 hover:text-muted-foreground'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative group">
                <pre className="bg-muted/40 border border-border/40 rounded-lg px-4 py-3 pr-12 text-[11px] font-mono text-foreground/80 leading-relaxed whitespace-pre-wrap break-all select-all">
                  {buildCmd(slug, os, apiBase)}
                </pre>
                <button
                  onClick={() => handleCopy(buildCmd(slug, os, apiBase))}
                  className={cn(
                    'absolute top-2.5 right-2.5 p-1.5 rounded-md transition-all duration-150',
                    copied
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'opacity-0 group-hover:opacity-100 bg-background border border-border/40 text-muted-foreground hover:text-foreground shadow-sm'
                  )}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {/* Path */}
            <div className="px-5 pb-4">
              <code className="text-[10px] font-mono text-muted-foreground/35">{displayPath(slug, os)}</code>
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-border/60 bg-muted/15 flex items-center">
              <button
                onClick={() => handleCopy(buildCmd(slug, os, apiBase))}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 h-9 rounded-lg text-[12px] font-medium transition-all duration-150',
                  copied
                    ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
                    : 'bg-foreground text-background hover:bg-foreground/90'
                )}
              >
                {copied
                  ? <><Check className="h-3.5 w-3.5" /> Copied!</>
                  : <><Copy className="h-3.5 w-3.5" /> Copy Command</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
