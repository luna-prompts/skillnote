'use client'

import { useState, useEffect } from 'react'
import {
  Copy, Check, RefreshCw, Target, BarChart3, Zap, Wrench, Bell,
  FolderOpen, Shield, Layers, Terminal, ExternalLink,
  FileText, Activity, Star, BookOpen, Download, Radio,
  Package, MessageSquare, Play,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/topbar'
import { getApiBaseUrl } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { dispatchJob, useJobPolling, type JobAgent, type JobStatus } from '@/lib/cli-jobs'
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

type Agent = 'claude-code' | 'openclaw'

type ConnectionStatus =
  | { kind: 'loading' }
  | { kind: 'connected'; label: string }
  | { kind: 'idle' }
  | { kind: 'error' }

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function formatRelative(iso: string): string {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const ageMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (ageMin < 1) return rtf.format(0, 'minute')
  if (ageMin < 60) return rtf.format(-ageMin, 'minute')
  if (ageMin < 1440) return rtf.format(-Math.round(ageMin / 60), 'hour')
  return rtf.format(-Math.round(ageMin / 1440), 'day')
}

const CC_FEATURES = [
  { icon: RefreshCw, title: 'Auto-sync', desc: 'Skills sync at session start and on collection change' },
  { icon: Target, title: 'Collection Picker', desc: 'Full-screen TUI to scope skills per project' },
  { icon: BarChart3, title: 'Usage Analytics', desc: 'Track which skills are used and rated by agents' },
  { icon: Zap, title: 'Status Line', desc: 'Active collection visible in Claude Code status bar' },
  { icon: Wrench, title: 'Skill Push', desc: 'Create skills from conversations via /skillnote:skill-push' },
  { icon: Bell, title: '6 Hooks', desc: 'SessionStart, FileChanged, PostToolUse, PostCompact, SubagentStart, Stop' },
]

const OC_FEATURES = [
  { icon: RefreshCw, title: 'Auto-sync', desc: 'Skills sync every 60s — available before each task' },
  { icon: Radio, title: 'Log-watcher', desc: 'Parses session JSONL to track which skills agents actually read' },
  { icon: Star, title: 'In-turn ratings', desc: 'Pre-filled curl command in every skill — rate without cross-session memory' },
  { icon: FileText, title: 'AGENTS.md graft', desc: 'Persistent <skillnote v1> block keeps registry active across sessions' },
  { icon: Download, title: 'Self-update', desc: 'Daily version check — auto-installs when a newer plugin is available' },
  { icon: Activity, title: 'Usage logging', desc: 'Agent reports task outcomes and skill IDs back to analytics' },
]

const CC_STEPS = [
  { text: 'Run the install command above' },
  { text: <>Run <code className="font-mono text-[12px] bg-muted/60 px-1.5 py-0.5 rounded">source ~/.zshrc</code> or open a new terminal</> },
  { text: <>Run <code className="font-mono text-[12px] bg-muted/60 px-1.5 py-0.5 rounded">claude</code> — the collection picker appears</> },
  { text: 'Start coding — skills activate automatically' },
]

const OC_STEPS = [
  { text: 'Run the install command above' },
  { text: 'Start OpenClaw — SkillNote prompts for your server URL on first load' },
  { text: <>Approve the <code className="font-mono text-[12px] bg-muted/60 px-1.5 py-0.5 rounded">AGENTS.md</code> graft when prompted (adds the registry block)</> },
  { text: 'Start using — skills sync before every task, usage tracked automatically' },
]

function CodeBlock({ content, label = 'terminal', multiline = false }: { content: string; label?: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    const ok = await copyText(content)
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }
  return (
    <div className="relative group">
      <div className="bg-zinc-950 dark:bg-zinc-950/80 border border-border/50 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
            <span className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
            <span className="w-2.5 h-2.5 rounded-full bg-white/[0.08]" />
            <span className="text-[10px] font-mono text-white/20 ml-2">{label}</span>
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
        {multiline ? (
          <pre className="px-4 py-3.5 text-[12.5px] font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap break-words select-all overflow-x-auto max-h-[260px]">{content}</pre>
        ) : (
          <div className="px-4 py-3.5 flex items-start">
            <span className="text-emerald-400/50 font-mono text-[13px] mr-2.5 select-none shrink-0">$</span>
            <code className="text-[13px] font-mono text-zinc-300 break-all leading-relaxed select-all">{content}</code>
          </div>
        )}
      </div>
    </div>
  )
}


function StatusPill({ status }: { status: ConnectionStatus }) {
  const dotCls =
    status.kind === 'connected' ? 'bg-emerald-500' :
    status.kind === 'error' ? 'bg-yellow-500' :
    status.kind === 'loading' ? 'bg-muted-foreground/40 animate-pulse' :
    'bg-muted-foreground/25'

  const text =
    status.kind === 'loading' ? 'Checking…' :
    status.kind === 'connected' ? `Connected · last activity ${status.label}` :
    status.kind === 'error' ? 'Cannot reach backend' :
    'Not yet connected'

  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/40 border border-border/40">
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotCls)} />
      <span className="text-[11px] text-muted-foreground">{text}</span>
    </div>
  )
}

function useClaudeCodeStatus(apiBase: string): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>({ kind: 'loading' })
  useEffect(() => {
    if (!apiBase) return
    let cancelled = false
    fetch(`${apiBase}/v1/analytics/skill-calls?limit=1`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { last_called_at?: string }[]) => {
        if (cancelled) return
        if (Array.isArray(data) && data.length > 0 && data[0].last_called_at) {
          const ageMs = Date.now() - new Date(data[0].last_called_at).getTime()
          if (ageMs <= SEVEN_DAYS_MS) {
            setStatus({ kind: 'connected', label: formatRelative(data[0].last_called_at) })
            return
          }
        }
        setStatus({ kind: 'idle' })
      })
      .catch(() => { if (!cancelled) setStatus({ kind: 'error' }) })
    return () => { cancelled = true }
  }, [apiBase])
  return status
}

function useOpenClawStatus(apiBase: string): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>({ kind: 'loading' })
  useEffect(() => {
    if (!apiBase) return
    let cancelled = false
    fetch(`${apiBase}/v1/openclaw/usage?limit=1`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { created_at: string }[]) => {
        if (cancelled) return
        if (Array.isArray(data) && data.length > 0) {
          const ageMs = Date.now() - new Date(data[0].created_at).getTime()
          if (ageMs <= SEVEN_DAYS_MS) {
            setStatus({ kind: 'connected', label: formatRelative(data[0].created_at) })
            return
          }
        }
        setStatus({ kind: 'idle' })
      })
      .catch(() => { if (!cancelled) setStatus({ kind: 'error' }) })
    return () => { cancelled = true }
  }, [apiBase])
  return status
}

type InstallMethod = 'prompt' | 'clawhub' | 'curl' | 'manual'

// Hook: fetch the personalized agent prompt from the backend (with apiBase
// already substituted in). Returns null while loading, the markdown text
// once ready, or an error message on failure.
function useAgentPrompt(apiBase: string, agent: 'openclaw' | 'claude-code') {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!apiBase) return
    let cancelled = false
    setText(null); setError(null)
    fetch(`${apiBase}/setup/agent-prompt?agent=${agent}`)
      .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(t => { if (!cancelled) setText(t) })
      .catch(e => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [apiBase, agent])
  return { text, error }
}

function OpenClawInstall({ apiBase }: { apiBase: string }) {
  // Default tab is 'prompt' — the api2cli-style copy-prompt is the dominant
  // OpenClaw install UX today, and it's the most robust path because the
  // agent does the install (handles missing prereqs, env vars, etc.).
  const [method, setMethod] = useState<InstallMethod>('prompt')
  const { text: promptText, error: promptError } = useAgentPrompt(apiBase, 'openclaw')

  const clawhubScript = `# Tell the skill where your SkillNote backend is, then install via clawhub.
# (clawhub itself doesn't take a host arg — env var is the recommended way.)
export SKILLNOTE_BASE_URL="${apiBase}"
clawhub install skillnote

# Then in your shell rc (~/.zshrc or ~/.bashrc) make it persistent:
echo 'export SKILLNOTE_BASE_URL="${apiBase}"' >> ~/.zshrc`

  const curlCmd = `curl -sf ${apiBase}/setup/agent | bash -s -- --agent openclaw`

  const manualScript = `# 1. Download bundle and extract into ~/.openclaw/skills/
mkdir -p ~/.openclaw/skills ~/.openclaw/skillnote
curl -sf ${apiBase}/v1/openclaw-bundle.zip -o /tmp/skillnote.zip
unzip -qo /tmp/skillnote.zip -d ~/.openclaw/skills/
rm /tmp/skillnote.zip

# 2. Write config with your SkillNote URL
echo '{"host":"${apiBase}","user_id":"openclaw-main"}' \\
  > ~/.openclaw/skillnote/config.json

# 3. Make sync.sh executable
chmod +x ~/.openclaw/skills/skillnote/sync.sh

# 4. Restart OpenClaw to pick up the new skill`

  return (
    <div>
      {/* Method selector */}
      <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/50 border border-border/40 mb-3 flex-wrap">
        {([
          { id: 'prompt' as InstallMethod, label: 'Copy prompt', icon: MessageSquare },
          { id: 'clawhub' as InstallMethod, label: 'clawhub', icon: Package },
          { id: 'curl' as InstallMethod, label: 'curl', icon: Terminal },
          { id: 'manual' as InstallMethod, label: 'Manual', icon: FileText },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setMethod(id)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-medium transition-all',
              method === id
                ? 'bg-background text-foreground shadow-sm border border-border/60'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {method === 'prompt' && (
        <>
          {promptError && (
            <p className="text-[12px] text-red-500 mb-2">Failed to load prompt: {promptError}</p>
          )}
          {!promptText && !promptError && (
            <p className="text-[12px] text-muted-foreground/40 mb-2">Loading personalized prompt…</p>
          )}
          {promptText && <CodeBlock content={promptText} label="markdown" multiline />}
          <p className="text-[11px] text-muted-foreground/40 mt-2 pl-1">
            <span className="font-medium text-muted-foreground/60">Recommended · zero terminal.</span> Paste this into a fresh OpenClaw session — your URL ({apiBase}) is already baked in. The agent handles install, config, and verification end-to-end.
          </p>
        </>
      )}

      {method === 'clawhub' && (
        <>
          <CodeBlock content={clawhubScript} label="bash" multiline />
          <p className="text-[11px] text-muted-foreground/40 mt-2 pl-1">
            For users who already have <code className="font-mono">clawhub</code>. Versioned + auto-updates via daily check.
          </p>
          <p className="text-[11px] text-muted-foreground/40 mt-1 pl-1">
            Note: clawhub doesn't accept a host argument — set <code className="font-mono">SKILLNOTE_BASE_URL</code> first so the skill knows where to talk to.
          </p>
        </>
      )}

      {method === 'curl' && (
        <>
          <CodeBlock content={curlCmd} />
          <p className="text-[11px] text-muted-foreground/40 mt-2 pl-1">
            Unified installer · Same command works for any agent — pass <code className="font-mono">--agent claude-code</code> or <code className="font-mono">--agent openclaw</code>. Pre-fills config with your URL and runs the first sync.
          </p>
        </>
      )}

      {method === 'manual' && (
        <>
          <CodeBlock content={manualScript} label="bash" multiline />
          <p className="text-[11px] text-muted-foreground/40 mt-2 pl-1">
            Step-by-step · For air-gapped environments or when you want full control over the install
          </p>
        </>
      )}
    </div>
  )
}


// ─── [Run via CLI] button + live log panel ────────────────────────────────
//
// Sits next to the curl install commands and offers a one-click alternative:
// dispatch a job to the local `skillnote bridge` long-poller, then stream
// progress back. The button is additive — the existing copy/paste install
// flow is untouched.

const STATUS_GLYPH: Record<JobStatus, string> = {
  pending: '⟳',
  running: '▶',
  succeeded: '✓',
  failed: '✗',
  cancelled: '✗',
}

const STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Waiting for CLI…',
  running: 'Running…',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const COLLAPSE_AFTER_SUCCESS_MS = 3000

function RunViaCliPanel({ agent }: { agent: JobAgent }) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [dispatching, setDispatching] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const { job, isPolling } = useJobPolling(jobId)

  // Collapse the panel 3s after a successful run, but keep the ✓ Connected
  // pill visible so the user has confirmation it ran.
  useEffect(() => {
    if (job?.status !== 'succeeded') return
    const t = setTimeout(() => setCollapsed(true), COLLAPSE_AFTER_SUCCESS_MS)
    return () => clearTimeout(t)
  }, [job?.status])

  const handleClick = async () => {
    setDispatching(true)
    setCollapsed(false)
    try {
      const { id } = await dispatchJob({ type: 'connect', agent })
      setJobId(id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to dispatch job'
      toast.error(`Could not start CLI job: ${msg}`)
    } finally {
      setDispatching(false)
    }
  }

  const status = job?.status ?? (jobId ? 'pending' : null)
  const showPanel = jobId !== null && !collapsed
  const showConnectedPill = job?.status === 'succeeded' && collapsed

  // Last 20 lines, joined for the <pre>.
  const tailLog = job?.log?.slice(-20) ?? []

  return (
    <div className="mt-3" data-testid="run-via-cli">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          onClick={handleClick}
          disabled={dispatching || isPolling}
          data-testid="run-via-cli-button"
        >
          <Play className="h-3 w-3" />
          {isPolling ? 'Running…' : dispatching ? 'Starting…' : 'Run via CLI'}
        </Button>
        <span className="text-[11px] text-muted-foreground/40">
          Requires <code className="font-mono">skillnote bridge</code> running locally.
        </span>
        {showConnectedPill && (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 text-[11px] font-medium"
            data-testid="run-via-cli-connected"
          >
            <Check className="h-3 w-3" />
            Connected
          </span>
        )}
      </div>

      {showPanel && status && (
        <div
          className="mt-3 rounded-lg border border-border/40 bg-zinc-950 dark:bg-zinc-950/80 overflow-hidden"
          data-testid="run-via-cli-panel"
        >
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06]">
            <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">
              cli · {agent}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-[11px] font-mono',
                status === 'succeeded' && 'text-emerald-400',
                status === 'failed' && 'text-red-400',
                status === 'cancelled' && 'text-red-400',
                status === 'running' && 'text-blue-400',
                status === 'pending' && 'text-white/40',
              )}
              data-testid="run-via-cli-status"
            >
              <span className={cn(status === 'pending' && 'animate-pulse')}>{STATUS_GLYPH[status]}</span>
              {STATUS_LABEL[status]}
            </span>
          </div>
          <pre
            className="px-3 py-2 text-[12px] font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto"
            data-testid="run-via-cli-log"
          >
            {tailLog.length > 0 ? tailLog.join('\n') : <span className="text-white/30">Waiting for output…</span>}
          </pre>
        </div>
      )}
    </div>
  )
}


export default function IntegrationsPage() {
  const [agent, setAgent] = useState<Agent>('claude-code')
  const [apiBase, setApiBase] = useState('http://localhost:8082')
  useEffect(() => { setApiBase(getApiBaseUrl()) }, [])

  const ccStatus = useClaudeCodeStatus(apiBase)
  const ocStatus = useOpenClawStatus(apiBase)

  const ccCmd = `curl -sf ${apiBase}/setup/agent | bash -s -- --agent claude-code`
  const ocCmd = `curl -sf ${apiBase}/setup/openclaw | bash`

  const isCC = agent === 'claude-code'

  return (
    <>
      <TopBar showFab={false} />
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">

          {/* Page title */}
          <div className="mb-8">
            <div className="flex items-center gap-2.5 mb-1">
              <Terminal className="h-5 w-5 text-muted-foreground/40" />
              <h1 className="text-xl font-semibold text-foreground">Connect</h1>
            </div>
            <p className="text-[13px] text-muted-foreground/60 pl-[30px]">
              Install the SkillNote plugin to sync skills and track usage.
            </p>
          </div>

          {/* Agent selector */}
          <div className="mb-8">
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/50 border border-border/40">
              {([
                { id: 'claude-code' as Agent, label: 'Claude Code' },
                { id: 'openclaw' as Agent, label: 'OpenClaw' },
              ] as const).map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setAgent(id)}
                  className={cn(
                    'px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-all',
                    agent === id
                      ? 'bg-background text-foreground shadow-sm border border-border/60'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Connection status */}
          <div className="mb-6">
            <StatusPill status={isCC ? ccStatus : ocStatus} />
          </div>

          {/* Install command */}
          <div className="mb-10">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-3">Install</p>
            {isCC ? (
              <>
                <CodeBlock content={ccCmd} />
                <p className="text-[11px] text-muted-foreground/30 mt-2 pl-1">
                  Installs to <code className="font-mono">~/.claude/plugins/skillnote</code> · No sudo required · macOS + Linux
                </p>
                <RunViaCliPanel agent="claude-code" />
              </>
            ) : (
              <>
                <OpenClawInstall apiBase={apiBase} />
                <RunViaCliPanel agent="openclaw" />
              </>
            )}
          </div>

          {/* Setup steps */}
          <div className="mb-10">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-3">Setup</p>
            <div className="border border-border/40 rounded-lg divide-y divide-border/30 bg-card">
              {(isCC ? CC_STEPS : OC_STEPS).map(({ text }, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-5 h-5 rounded-full bg-muted/80 text-[10px] font-bold text-muted-foreground flex items-center justify-center shrink-0 tabular-nums">{i + 1}</span>
                  <p className="text-[13px] text-foreground/80">{text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Features */}
          <div className="mb-10">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-3">Included</p>
            <div className="border border-border/40 rounded-lg divide-y divide-border/30 bg-card">
              {(isCC ? CC_FEATURES : OC_FEATURES).map(({ icon: Icon, title, desc }) => (
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

          {/* Collections callout — Claude Code only */}
          {isCC && (
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
          )}

          {/* OpenClaw: how analytics work */}
          {!isCC && (
            <div className="mb-10">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-3">How analytics work</p>
              <div className="border border-border/40 rounded-lg bg-card p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <Radio className="h-4 w-4 text-muted-foreground/50 mt-0.5 shrink-0" />
                  <p className="text-[13px] text-foreground/80 leading-relaxed">
                    <span className="font-medium">Log-watcher</span> runs as a background daemon and reads your OpenClaw session JSONL files. Every time a skill is read, it fires a <code className="font-mono text-[12px]">POST /v1/hooks/skill-used</code> event — fully automatic, no agent involvement.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <BookOpen className="h-4 w-4 text-muted-foreground/50 mt-0.5 shrink-0" />
                  <p className="text-[13px] text-foreground/80 leading-relaxed">
                    <span className="font-medium">Rating footer</span> appended to every synced skill gives the agent a pre-filled <code className="font-mono text-[12px]">curl</code> command to rate the skill in the same turn — no cross-session memory needed.
                  </p>
                </div>
              </div>
            </div>
          )}

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
