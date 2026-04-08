'use client'

import { useState, useEffect } from 'react'
import { Copy, Check, RefreshCw, Target, BarChart3, Zap, Wrench, Bell, FolderOpen, Shield, Layers, Terminal, ExternalLink } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { getApiBaseUrl } from '@/lib/api/client'
import { cn } from '@/lib/utils'

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true } catch { /* fall through */ }
  }
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
  document.body.appendChild(el)
  el.focus()
  el.select()
  try { document.execCommand('copy'); document.body.removeChild(el); return true } catch { /* ignore */ }
  document.body.removeChild(el)
  return false
}

const FEATURES = [
  { icon: RefreshCw, title: 'Auto-sync', desc: 'Skills sync at session start and on collection change' },
  { icon: Target, title: 'Collection Picker', desc: 'Full-screen TUI to scope skills per project' },
  { icon: BarChart3, title: 'Usage Analytics', desc: 'Track which skills are used and rated by agents' },
  { icon: Zap, title: 'Status Line', desc: 'Active collection visible in Claude Code status bar' },
  { icon: Wrench, title: 'Skill Push', desc: 'Create skills from conversations via /skillnote:skill-push' },
  { icon: Bell, title: '6 Hooks', desc: 'SessionStart, FileChanged, PostToolUse, PostCompact, SubagentStart, Stop' },
]

export default function IntegrationsPage() {
  const [copied, setCopied] = useState(false)
  const [apiBase, setApiBase] = useState('http://localhost:8082')

  useEffect(() => { setApiBase(getApiBaseUrl()) }, [])

  const setupCmd = `curl -sf ${apiBase}/setup | bash`

  const handleCopy = async () => {
    const ok = await copyText(setupCmd)
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  return (
    <>
      <TopBar showFab={false} />
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">

          {/* Page title — Notion style */}
          <div className="mb-8">
            <div className="flex items-center gap-2.5 mb-1">
              <Terminal className="h-5 w-5 text-muted-foreground/40" />
              <h1 className="text-xl font-semibold text-foreground">Connect Claude Code</h1>
            </div>
            <p className="text-[13px] text-muted-foreground/60 pl-[30px]">
              Install the SkillNote plugin to sync skills, pick collections, and track usage.
            </p>
          </div>

          {/* Install command */}
          <div className="mb-10">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-3">Install</p>
            <div className="relative group">
              <div className="bg-zinc-950 dark:bg-zinc-950/80 border border-border/50 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
                    <span className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
                    <span className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
                    <span className="text-[10px] font-mono text-white/20 ml-2">terminal</span>
                  </div>
                  <button
                    onClick={handleCopy}
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-all',
                      copied
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'text-white/30 hover:text-white/60 hover:bg-white/5'
                    )}
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="px-4 py-3.5 flex items-start">
                  <span className="text-emerald-400/50 font-mono text-[13px] mr-2.5 select-none shrink-0">$</span>
                  <code className="text-[13px] font-mono text-zinc-300 break-all leading-relaxed select-all">{setupCmd}</code>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground/30 mt-2 pl-1">
              Installs to <code className="font-mono">~/.claude/plugins/skillnote</code> &middot; No sudo required &middot; macOS + Linux
            </p>
          </div>

          {/* Setup steps — inline, compact */}
          <div className="mb-10">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-3">Setup</p>
            <div className="border border-border/40 rounded-lg divide-y divide-border/30 bg-card">
              {[
                { n: '1', text: 'Run the install command above' },
                { n: '2', text: <>Run <code className="font-mono text-[12px] bg-muted/60 px-1.5 py-0.5 rounded">source ~/.zshrc</code> or open a new terminal</> },
                { n: '3', text: <>Run <code className="font-mono text-[12px] bg-muted/60 px-1.5 py-0.5 rounded">claude</code> — the collection picker appears</> },
                { n: '4', text: 'Start coding — skills activate automatically' },
              ].map(({ n, text }) => (
                <div key={n} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-5 h-5 rounded-full bg-muted/80 text-[10px] font-bold text-muted-foreground flex items-center justify-center shrink-0 tabular-nums">{n}</span>
                  <p className="text-[13px] text-foreground/80">{text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Features — 2-column property-style */}
          <div className="mb-10">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-3">Included</p>
            <div className="border border-border/40 rounded-lg divide-y divide-border/30 bg-card">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="w-7 h-7 rounded-md bg-muted/60 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground">{title}</p>
                    <p className="text-[12px] text-muted-foreground/60 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Collections callout */}
          <div className="mb-10">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-3">Why collections?</p>
            <div className="border border-border/40 rounded-lg bg-card p-5">
              <div className="flex items-start gap-3 mb-4">
                <FolderOpen className="h-4 w-4 text-muted-foreground/50 mt-0.5 shrink-0" />
                <p className="text-[13px] text-foreground/80 leading-relaxed">
                  Collections group skills by purpose and scope them per project. Each project gets one active collection.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: Layers, value: '15', label: 'skills per collection' },
                  { icon: Shield, value: '~8k', label: 'char description budget' },
                  { icon: FolderOpen, value: '1:1', label: 'collection per project' },
                ].map(({ icon: Icon, value, label }) => (
                  <div key={label} className="bg-muted/30 rounded-lg px-3 py-3 text-center">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-[18px] font-bold text-foreground tabular-nums leading-none mb-1">{value}</p>
                    <p className="text-[10px] text-muted-foreground/50">{label}</p>
                  </div>
                ))}
              </div>
              <p className="text-[12px] text-muted-foreground/40 mt-4 leading-relaxed">
                Too many active skills = descriptions get truncated = skills stop triggering reliably. Collections keep Claude fast and accurate.
              </p>
            </div>
          </div>

          {/* Links */}
          <div className="flex items-center gap-4 pb-8">
            <a href="https://github.com/luna-prompts/skillnote" target="_blank" rel="noopener noreferrer" className="text-[12px] text-muted-foreground/50 hover:text-foreground transition-colors inline-flex items-center gap-1">
              GitHub <ExternalLink className="h-2.5 w-2.5" />
            </a>
            <a href="https://github.com/luna-prompts/skillnote#readme" target="_blank" rel="noopener noreferrer" className="text-[12px] text-muted-foreground/50 hover:text-foreground transition-colors inline-flex items-center gap-1">
              Documentation <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>

        </div>
      </div>
    </>
  )
}
