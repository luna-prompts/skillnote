'use client'

import { useState, useEffect } from 'react'
import { Copy, Check, RefreshCw, Target, BarChart3, Zap, Wrench, Bell, FolderOpen } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { getApiBaseUrl } from '@/lib/api/client'
import { cn } from '@/lib/utils'

// ── copy helper ──────────────────────────────────────────────────────────────

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

// ── feature data ─────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: RefreshCw,
    title: 'Auto-sync',
    description: 'Skills sync at session start and on collection change',
  },
  {
    icon: Target,
    title: 'Collection Picker',
    description: 'Choose skills per project at every claude launch',
  },
  {
    icon: BarChart3,
    title: 'Analytics',
    description: 'Track which skills are used, how often, by which agents',
  },
  {
    icon: Zap,
    title: 'Status Line',
    description: 'See active collection + skills at the bottom of Claude Code',
  },
  {
    icon: Wrench,
    title: 'Skill Push',
    description: 'Create new skills from conversations with /skillnote:skill-push',
  },
  {
    icon: Bell,
    title: '6 Hooks',
    description: 'SessionStart, FileChanged, PostToolUse, PostCompact, SubagentStart, Stop',
  },
]

const STEPS = [
  { step: 1, text: 'Run the curl command above' },
  { step: 2, text: 'source ~/.zshrc (or open a new terminal)' },
  { step: 3, text: 'Run claude \u2014 the skill collection picker will appear' },
  { step: 4, text: 'Start coding \u2014 skills activate automatically' },
]

// ── page ─────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const [copied, setCopied] = useState(false)
  const [apiBase, setApiBase] = useState('http://localhost:8082')

  useEffect(() => {
    setApiBase(getApiBaseUrl())
  }, [])

  const setupCmd = `curl -sf ${apiBase}/setup | bash`

  const handleCopy = async () => {
    const ok = await copyText(setupCmd)
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  return (
    <>
      <TopBar showFab={false} />

      <style>{`
        @keyframes riseIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }
        .i-1 { animation: riseIn .35s cubic-bezier(.16,1,.3,1) both }
        .i-2 { animation: riseIn .35s cubic-bezier(.16,1,.3,1) .07s both }
        .i-3 { animation: riseIn .35s cubic-bezier(.16,1,.3,1) .13s both }
        .i-4 { animation: riseIn .35s cubic-bezier(.16,1,.3,1) .19s both }
        .i-5 { animation: riseIn .35s cubic-bezier(.16,1,.3,1) .25s both }
      `}</style>

      <main className="flex-1 overflow-auto">
        <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-8 sm:py-12">

          {/* ── Hero ─────────────────────────────────────────────────── */}
          <div className="i-1 mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
              Connect Claude Code
            </h1>
            <p className="text-[14px] text-muted-foreground mt-2 leading-relaxed">
              One command to sync your skills to Claude Code.
            </p>

            {/* Terminal block */}
            <div className="mt-5 relative group">
              <div className="bg-zinc-950 dark:bg-zinc-950/80 border border-border/40 rounded-xl overflow-hidden">
                {/* Terminal chrome */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
                    <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
                    <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
                  </div>
                  <span className="text-[11px] font-mono text-white/20 ml-2">terminal</span>
                </div>
                {/* Command */}
                <div className="px-5 py-4 pr-14 flex items-center">
                  <span className="text-emerald-400/70 font-mono text-[13px] mr-2.5 select-none shrink-0">$</span>
                  <code className="text-[13px] font-mono text-zinc-200 break-all leading-relaxed select-all">
                    {setupCmd}
                  </code>
                </div>
              </div>
              {/* Copy button */}
              <button
                onClick={handleCopy}
                className={cn(
                  'absolute top-[42px] right-3 p-2 rounded-lg transition-all duration-150',
                  copied
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'opacity-0 group-hover:opacity-100 bg-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
                )}
                title="Copy command"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* ── What's Included ───────────────────────────────────────── */}
          <div className="i-2 mb-10">
            <h2 className="text-[13px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-4">
              What&apos;s included
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="bg-card border border-border/40 rounded-xl px-4 py-4 hover:border-border/60 transition-colors"
                >
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-accent/8 flex items-center justify-center shrink-0">
                      <Icon className="h-3.5 w-3.5 text-accent" />
                    </div>
                    <span className="text-[13px] font-semibold text-foreground">{title}</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground/70 leading-relaxed">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Getting Started ───────────────────────────────────────── */}
          <div className="i-3 mb-10">
            <h2 className="text-[13px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-4">
              Getting started
            </h2>
            <div className="bg-card border border-border/40 rounded-xl overflow-hidden divide-y divide-border/30">
              {STEPS.map(({ step, text }) => (
                <div key={step} className="flex items-start gap-4 px-5 py-4">
                  <span className="w-6 h-6 rounded-full bg-accent/10 text-accent text-[12px] font-semibold flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
                    {step}
                  </span>
                  <div className="flex-1 min-w-0">
                    {step === 2 ? (
                      <p className="text-[13px] text-foreground leading-relaxed">
                        <code className="font-mono text-[12px] bg-muted/60 px-1.5 py-0.5 rounded text-foreground/80">source ~/.zshrc</code>
                        {' '}(or open a new terminal)
                      </p>
                    ) : step === 3 ? (
                      <p className="text-[13px] text-foreground leading-relaxed">
                        Run <code className="font-mono text-[12px] bg-muted/60 px-1.5 py-0.5 rounded text-foreground/80">claude</code> — the skill collection picker will appear
                      </p>
                    ) : (
                      <p className="text-[13px] text-foreground leading-relaxed">{text}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Why Collections? ──────────────────────────────────────── */}
          <div className="i-4 mb-10">
            <h2 className="text-[13px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-4">
              Why collections?
            </h2>
            <div className="bg-accent/[0.03] border border-accent/15 rounded-xl px-5 py-5">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                  <FolderOpen className="h-3.5 w-3.5 text-accent" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-foreground mb-1">Scope the right skills to the right project</p>
                  <p className="text-[12px] text-muted-foreground/70 leading-relaxed">
                    Collections group skills by purpose — Conventions, DevOps, Frontend, and more. Each project can use a different collection.
                  </p>
                </div>
              </div>
              <div className="space-y-3 pl-10">
                <div className="flex items-start gap-2.5">
                  <div className="w-1 h-1 rounded-full bg-muted-foreground/30 mt-2 shrink-0" />
                  <p className="text-[12px] text-muted-foreground/60 leading-relaxed">
                    Each collection is limited to <span className="font-semibold text-foreground/70">15 skills</span> for optimal Claude Code performance
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="w-1 h-1 rounded-full bg-muted-foreground/30 mt-2 shrink-0" />
                  <p className="text-[12px] text-muted-foreground/60 leading-relaxed">
                    The skill description budget is <span className="font-semibold text-foreground/70">~8,000 characters</span> shared across all active skills
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="w-1 h-1 rounded-full bg-muted-foreground/30 mt-2 shrink-0" />
                  <p className="text-[12px] text-muted-foreground/60 leading-relaxed">
                    Too many skills = descriptions get truncated = skills stop triggering reliably
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="w-1 h-1 rounded-full bg-muted-foreground/30 mt-2 shrink-0" />
                  <p className="text-[12px] text-muted-foreground/60 leading-relaxed">
                    Collections let you scope exactly which skills are active per project
                  </p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
    </>
  )
}
