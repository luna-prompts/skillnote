'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Check, Search, ChevronDown, X, Wifi, WifiOff, Clock, Users, Radio } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { getSkills, syncSkillsFromApi } from '@/lib/skills-store'
import { getApiBaseUrl } from '@/lib/api/client'
import type { Skill } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type AgentId = 'openclaw' | 'claude' | 'cursor' | 'openhands' | 'universal'

const AGENTS = [
  { id: 'openclaw'  as AgentId, label: 'OpenClaw',    file: '~/.openclaw/settings.json',
    generate: (url: string) => JSON.stringify({ mcpServers: { skillnote: { type: 'http', url } } }, null, 2) },
  { id: 'claude'    as AgentId, label: 'Claude Code', file: '~/.claude/settings.json',
    generate: (url: string) => JSON.stringify({ mcpServers: { skillnote: { type: 'http', url } } }, null, 2) },
  { id: 'cursor'    as AgentId, label: 'Cursor',      file: '.cursor/mcp.json',
    generate: (url: string) => JSON.stringify({ mcpServers: { skillnote: { url } } }, null, 2) },
  { id: 'openhands' as AgentId, label: 'OpenHands',   file: 'config.toml',
    generate: (url: string) => `[[mcp_servers]]\nname = "skillnote"\ntransport = "http"\nurl = "${url}"` },
  { id: 'universal' as AgentId, label: 'Universal',   file: 'MCP URL',
    generate: (url: string) => url },
]

function buildMcpBase() {
  return getApiBaseUrl().replace(':8082', ':8083').replace(/\/v1\/?$/, '').replace(/\/$/, '')
}
function buildUrl(col: string | null) {
  const base = buildMcpBase()
  return col ? `${base}/mcp?collections=${encodeURIComponent(col)}` : `${base}/mcp`
}

// ─── types ────────────────────────────────────────────────────────────────────

type McpConnection = {
  id: string; connected_at: number; duration_seconds: number
  user_agent: string; remote: string; scope: string | null
}
type McpStatus = {
  status: 'online' | 'offline'; uptime_seconds: number
  active_connections: number; connections: McpConnection[]
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(s: number) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
function fmtUptime(s: number) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return m ? `${h}h ${m}m` : `${h}h`
}
function guessAgent(ua: string) {
  const u = ua.toLowerCase()
  if (u.includes('openclaw'))  return 'OpenClaw'
  if (u.includes('claude'))    return 'Claude Code'
  if (u.includes('cursor'))    return 'Cursor'
  if (u.includes('openhands')) return 'OpenHands'
  if (u.includes('python'))    return 'Python'
  if (u.includes('node'))      return 'Node.js'
  if (!ua.trim())              return 'Unknown agent'
  return ua.length > 24 ? ua.slice(0, 22) + '…' : ua
}

// ─── copy button ──────────────────────────────────────────────────────────────

function CopyBtn({ text, label = 'Copy', size = 'md' }: { text: string; label?: string; size?: 'sm' | 'md' }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 2000) }}
      className={cn(
        'inline-flex items-center gap-1.5 font-medium rounded-lg transition-all shrink-0',
        'text-muted-foreground/60 hover:text-foreground hover:bg-muted/60',
        size === 'sm' ? 'text-[11px] px-2 py-1' : 'text-[12px] px-2.5 py-1.5'
      )}
    >
      {ok ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {ok ? 'Copied' : label}
    </button>
  )
}

// ─── scope selector ───────────────────────────────────────────────────────────

function ScopeSelector({ collections, totalSkills, value, onChange }: {
  collections: { name: string; count: number }[]
  totalSkills: number
  value: string | null
  onChange: (v: string | null) => void
}) {
  const [open, setOpen]     = useState(false)
  const [q, setQ]           = useState('')
  const [focused, setFocused] = useState(-1) // -1 = "All Skills"
  const triggerRef          = useRef<HTMLButtonElement>(null)
  const dropRef             = useRef<HTMLDivElement>(null)
  const inputRef            = useRef<HTMLInputElement>(null)
  const listRef             = useRef<HTMLDivElement>(null)

  // position: fixed — escapes every stacking context
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, flipUp: false })

  const reposition = () => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    // approximate max dropdown height: list (320) + search header (~44) + footer (~32) = ~396
    const dropH = 400
    const spaceBelow = window.innerHeight - r.bottom - 8
    const spaceAbove = r.top - 8
    const flipUp = spaceBelow < dropH && spaceAbove > spaceBelow
    setPos({
      top: flipUp ? r.top - Math.min(dropH, spaceAbove) - 6 : r.bottom + 6,
      left: r.left,
      width: r.width,
      flipUp,
    })
  }

  const openDrop = () => {
    reposition()
    setOpen(true)
    setFocused(-1)
  }

  useEffect(() => {
    if (!open) { setQ(''); return }
    setTimeout(() => inputRef.current?.focus(), 10)
    const onScroll = () => reposition()
    const onResize = () => reposition()
    const onKey    = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus() }
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // close on outside click
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !dropRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  const filtered = useMemo(() =>
    q ? collections.filter(c => c.name.toLowerCase().includes(q.toLowerCase())) : collections,
    [collections, q]
  )

  // clamp focused when filtered list shrinks (e.g. user types and fewer items match)
  useEffect(() => {
    if (filtered.length === 0) setFocused(-1)
    else if (focused >= filtered.length) setFocused(filtered.length - 1)
  }, [filtered.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // keyboard navigation through list
  const totalItems = filtered.length + (q ? 0 : 1) // "All Skills" row only shown when q is empty
  const handleInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(f => Math.min(f + 1, totalItems - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setFocused(f => Math.max(f - 1, q ? 0 : -1)) }
    if (e.key === 'Enter') {
      if (focused === -1 && !q) { onChange(null); setOpen(false) }
      else if (filtered[focused]) { onChange(filtered[focused].name); setOpen(false) }
    }
  }

  // scroll focused item into view
  useEffect(() => {
    if (!listRef.current || focused < 0) return
    const items = listRef.current.querySelectorAll('[data-item]')
    items[focused]?.scrollIntoView({ block: 'nearest' })
  }, [focused])

  const activeCount = value ? (collections.find(c => c.name === value)?.count ?? 0) : totalSkills

  // group by first letter for large lists
  const grouped = useMemo(() => {
    if (q || collections.length < 10) return null
    const map = new Map<string, typeof collections>()
    filtered.forEach(c => {
      const letter = c.name[0].toUpperCase()
      if (!map.has(letter)) map.set(letter, [])
      map.get(letter)!.push(c)
    })
    return map
  }, [filtered, q, collections.length])

  return (
    <div>
      {/* trigger */}
      <button
        ref={triggerRef}
        onClick={() => open ? setOpen(false) : openDrop()}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all duration-150 focus:outline-none',
          open
            ? 'border-accent/40 bg-card ring-2 ring-accent/8'
            : 'border-border/60 bg-card hover:border-border'
        )}
      >
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <div className={cn(
            'w-2 h-2 rounded-full shrink-0 transition-colors duration-200',
            value ? 'bg-accent' : 'bg-muted-foreground/20'
          )} />
          <span className="text-[13px] font-medium text-foreground truncate">
            {value ?? 'All Skills'}
          </span>
          {value && (
            <span className="text-[11px] text-muted-foreground/40 truncate hidden sm:block">
              collection
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-[12px] text-muted-foreground/50 tabular-nums">
            {activeCount} {activeCount === 1 ? 'skill' : 'skills'}
          </span>
          {value && (
            <span
              role="button"
              tabIndex={-1}
              onClick={e => { e.stopPropagation(); onChange(null) }}
              className="w-5 h-5 rounded-md flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className={cn(
            'h-3.5 w-3.5 text-muted-foreground/40 transition-transform duration-200',
            open && 'rotate-180'
          )} />
        </div>
      </button>

      {/* dropdown — portal to body so CSS transform on animated ancestors can't hijack position:fixed */}
      {open && createPortal(
        <div
          ref={dropRef}
          className={cn('rounded-xl border border-border/70 bg-card shadow-2xl shadow-black/15 overflow-hidden', pos.flipUp ? 'scope-dd-flip' : 'scope-dd')}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999,
            transformOrigin: pos.flipUp ? 'bottom' : 'top',
          }}
        >
          {/* search */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border/40 bg-muted/10">
            <Search className="h-3.5 w-3.5 text-muted-foreground/35 shrink-0" />
            <input
              ref={inputRef}
              value={q}
              onChange={e => { setQ(e.target.value); setFocused(e.target.value ? 0 : -1) }}
              onKeyDown={handleInputKey}
              placeholder={collections.length > 0 ? `Search ${collections.length} collections…` : 'No collections yet'}
              className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/35 outline-none"
            />
            {q && (
              <button onClick={() => { setQ(''); setFocused(-1); inputRef.current?.focus() }}
                className="text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* list */}
          <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: 320 }}>

            {/* All Skills row */}
            {!q && (
              <button
                data-item
                onClick={() => { onChange(null); setOpen(false) }}
                className={cn(
                  'w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors',
                  focused === -1 ? 'bg-muted/50' : 'hover:bg-muted/30',
                  !value && 'bg-accent/5'
                )}
                onMouseEnter={() => setFocused(-1)}
              >
                <div className="flex items-center gap-2.5">
                  <span className={cn('w-1.5 h-1.5 rounded-full transition-colors', !value ? 'bg-accent' : 'bg-muted-foreground/20')} />
                  <span className={cn('text-[13px]', !value ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                    All Skills
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-muted-foreground/40 tabular-nums">{totalSkills}</span>
                  {!value && <Check className="h-3.5 w-3.5 text-accent" />}
                </div>
              </button>
            )}

            {/* collection rows — grouped when many */}
            {grouped
              ? Array.from(grouped.entries()).map(([letter, items]) => (
                  <div key={letter}>
                    <div className="px-4 py-1 bg-muted/20 border-y border-border/20">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/30">{letter}</span>
                    </div>
                    {items.map(c => {
                      const idx = filtered.indexOf(c)
                      return (
                        <CollectionRow key={c.name} c={c} value={value} focused={focused === idx}
                          onSelect={() => { onChange(c.name); setOpen(false) }}
                          onHover={() => setFocused(idx)} />
                      )
                    })}
                  </div>
                ))
              : filtered.map((c, idx) => (
                  <CollectionRow key={c.name} c={c} value={value} focused={focused === idx}
                    onSelect={() => { onChange(c.name); setOpen(false) }}
                    onHover={() => setFocused(idx)} />
                ))
            }

            {filtered.length === 0 && q && (
              <div className="px-4 py-8 text-center">
                <p className="text-[13px] text-muted-foreground/50">No collections match</p>
                <p className="text-[12px] text-muted-foreground/30 mt-1">"{q}"</p>
              </div>
            )}

            {collections.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-[13px] text-muted-foreground/50">No collections yet</p>
                <p className="text-[12px] text-muted-foreground/30 mt-1">Add collections to your skills</p>
              </div>
            )}
          </div>

          {/* footer */}
          <div className="px-4 py-2 border-t border-border/30 bg-muted/10 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/30">
              {q ? `${filtered.length} of ${collections.length}` : `${collections.length}`} collections
            </span>
            <span className="text-[11px] text-muted-foreground/20">↑↓ navigate · ↵ select · esc close</span>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function CollectionRow({ c, value, focused, onSelect, onHover }: {
  c: { name: string; count: number }
  value: string | null
  focused: boolean
  onSelect: () => void
  onHover: () => void
}) {
  const isActive = value === c.name
  return (
    <button
      data-item
      onClick={onSelect}
      onMouseEnter={onHover}
      className={cn(
        'w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors',
        focused ? 'bg-muted/50' : isActive ? 'bg-accent/5' : 'hover:bg-muted/30'
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0 transition-colors', isActive ? 'bg-accent' : 'bg-muted-foreground/15')} />
        <span className={cn('text-[13px] truncate', isActive ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
          {c.name}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-3">
        <span className="text-[12px] text-muted-foreground/40 tabular-nums">{c.count}</span>
        {isActive && <Check className="h-3.5 w-3.5 text-accent" />}
      </div>
    </button>
  )
}

// ─── config panel ─────────────────────────────────────────────────────────────

function ConfigPanel({ agent, setAgent, config, agentDef, mcpUrl }: {
  agent: AgentId
  setAgent: (a: AgentId) => void
  config: string
  agentDef: typeof AGENTS[number]
  mcpUrl: string
}) {
  return (
    <div className="bg-card border border-border/40 rounded-2xl overflow-hidden flex flex-col">
      {/* agent tabs */}
      <div className="flex items-center gap-0 border-b border-border/40 overflow-x-auto scrollbar-hide">
        {AGENTS.map(a => (
          <button
            key={a.id}
            onClick={() => setAgent(a.id)}
            className={cn(
              'px-4 py-3 text-[12.5px] font-medium whitespace-nowrap transition-all duration-150 border-b-2 -mb-px shrink-0',
              agent === a.id
                ? 'text-foreground border-accent'
                : 'text-muted-foreground/50 border-transparent hover:text-muted-foreground'
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* file label */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30 bg-muted/20">
        <span className="text-[12px] font-mono text-muted-foreground/50">{agentDef.file}</span>
        <CopyBtn text={config} />
      </div>

      {/* code — dark area, clean, no chrome */}
      {agentDef.id === 'universal' ? (
        <div className="bg-[hsl(var(--card))] dark:bg-zinc-950/70 px-5 py-5 flex-1">
          <code className="text-[13px] font-mono text-emerald-500 break-all leading-relaxed">{config}</code>
        </div>
      ) : (
        <pre className="bg-[hsl(var(--card))] dark:bg-zinc-950/70 px-5 py-5 text-[12.5px] font-mono leading-[1.9] text-muted-foreground overflow-x-auto flex-1">
          <code>{config}</code>
        </pre>
      )}

      {/* url row */}
      <div className="flex items-center gap-3 px-4 py-3 border-t border-border/30 bg-muted/10">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70 shrink-0" />
        <code className="flex-1 text-[11.5px] font-mono text-muted-foreground/50 truncate min-w-0">{mcpUrl}</code>
        <CopyBtn text={mcpUrl} label="Copy URL" size="sm" />
      </div>
    </div>
  )
}

// ─── live connections panel ───────────────────────────────────────────────────

function ConnectionsPanel() {
  const [status, setStatus]     = useState<McpStatus | null>(null)
  const [error, setError]       = useState(false)
  const [lastPoll, setLastPoll] = useState<number | null>(null)
  const [, setTick]             = useState(0)   // forces re-render every second
  const [q, setQ]               = useState('')

  const poll = async () => {
    try {
      const res = await fetch(`${buildMcpBase()}/status`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) throw new Error()
      setStatus(await res.json())
      setError(false)
    } catch {
      setError(true)
      setStatus(null)
    }
    setLastPoll(Date.now())
  }

  useEffect(() => {
    poll()
    const pollId = setInterval(poll, 5000)
    const tickId = setInterval(() => setTick(t => t + 1), 1000)
    return () => { clearInterval(pollId); clearInterval(tickId) }
  }, [])

  const online    = !error && status !== null
  // seconds elapsed since last successful poll — added to server timestamps for live counters
  const elapsedSincePoll = lastPoll ? Math.floor((Date.now() - lastPoll) / 1000) : 0

  const filtered = useMemo(() => {
    if (!online || !status) return []
    if (!q) return status.connections
    const lq = q.toLowerCase()
    return status.connections.filter(c =>
      guessAgent(c.user_agent).toLowerCase().includes(lq) ||
      c.remote.includes(lq) ||
      (c.scope ?? '').toLowerCase().includes(lq)
    )
  }, [status, q, online])

  return (
    <div className="bg-card border border-border/40 rounded-2xl overflow-hidden flex flex-col h-full">
      {/* header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-semibold text-foreground">Live Connections</span>
          {online && status!.active_connections > 0 && (
            <span className="inline-flex items-center h-5 px-1.5 rounded-md bg-emerald-500/10 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {status!.active_connections}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {online && (
            <span className="text-[11px] text-muted-foreground/40 font-mono hidden sm:block">
              up {fmtUptime(status!.uptime_seconds + elapsedSincePoll)}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {online
              ? <Wifi className="h-3.5 w-3.5 text-emerald-500" />
              : <WifiOff className="h-3.5 w-3.5 text-muted-foreground/30" />
            }
            <span className={cn(
              'text-[12px] font-medium',
              online ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/40'
            )}>
              {online ? 'online' : 'offline'}
            </span>
          </div>
        </div>
      </div>

      {/* search — shows when there are connections */}
      {online && status!.active_connections > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30 bg-muted/10">
          <Search className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={`Filter ${status!.active_connections} connections…`}
            className="flex-1 bg-transparent text-[12.5px] text-foreground placeholder:text-muted-foreground/30 outline-none"
          />
          {q && (
            <button onClick={() => setQ('')} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* body */}
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: 380 }}>
        {!online ? (
          <div className="flex flex-col items-center gap-2.5 py-10 px-6">
            <div className="w-10 h-10 rounded-xl bg-muted/50 border border-border/30 flex items-center justify-center">
              <Radio className="h-4 w-4 text-muted-foreground/20" />
            </div>
            <p className="text-[13px] text-muted-foreground/50">MCP server not reachable</p>
            <p className="text-[11px] font-mono text-muted-foreground/25">{buildMcpBase()}/status</p>
          </div>
        ) : filtered.length === 0 && !q ? (
          <div className="flex flex-col items-center gap-2.5 py-10 px-6">
            <div className="w-10 h-10 rounded-xl bg-muted/50 border border-border/30 flex items-center justify-center">
              <Users className="h-4 w-4 text-muted-foreground/20" />
            </div>
            <p className="text-[13px] text-muted-foreground/50">No agents connected</p>
            <p className="text-[11px] text-muted-foreground/30">Connect using the config</p>
          </div>
        ) : filtered.length === 0 && q ? (
          <div className="px-5 py-8 text-center text-[13px] text-muted-foreground/40">
            No connections match "{q}"
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {filtered.map(conn => (
              <div key={conn.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 conn-pulse" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground leading-snug truncate">
                    {guessAgent(conn.user_agent)}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[11px] text-muted-foreground/40 font-mono">{conn.remote}</span>
                    {conn.scope && (
                      <>
                        <span className="text-muted-foreground/20">·</span>
                        <span className="text-[11px] text-accent/60 truncate max-w-[80px]">{conn.scope}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground/35 shrink-0">
                  <Clock className="h-3 w-3" />
                  <span className="text-[11px] font-mono tabular-nums">{fmtDuration(conn.duration_seconds + elapsedSincePoll)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* footer */}
      <div className="px-5 py-2 border-t border-border/30 bg-muted/10 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground/30">
          {lastPoll
            ? elapsedSincePoll === 0 ? 'just updated' : `${elapsedSincePoll}s ago`
            : 'connecting…'}
        </span>
        <span className="text-[11px] text-muted-foreground/25">polls every 5s</span>
      </div>
    </div>
  )
}

// ─── session status bar ───────────────────────────────────────────────────────

function SessionStatus({ mcpUrl, agentLabel, skillCount, scopeLabel }: {
  mcpUrl: string; agentLabel: string; skillCount: number; scopeLabel: string | null
}) {
  const items = [
    { label: 'Protocol',  value: 'HTTP · JSON-RPC 2.0' },
    { label: 'Transport', value: 'streamable-http / SSE' },
    scopeLabel
      ? { label: 'Scope',  value: scopeLabel, accent: true }
      : { label: 'Tools',  value: `${skillCount} registered` },
    { label: 'Agent',     value: agentLabel },
    { label: 'Status',    value: 'ready', emerald: true },
  ]

  return (
    <div className="bg-card border border-border/40 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/30">
        <span className="text-[12px] font-semibold text-foreground/60 uppercase tracking-wide">Session</span>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 conn-pulse" />
          <code className="text-[11px] font-mono text-muted-foreground/40 truncate max-w-[280px] hidden sm:block">{mcpUrl}</code>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-border/30">
        {items.map((item, i) => (
          <div key={i} className="px-5 py-3.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-widest text-muted-foreground/35 mb-1">
              {item.label}
            </p>
            <p className={cn(
              'text-[13px] font-medium leading-snug',
              'emerald' in item && item.emerald
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'accent' in item && item.accent
                  ? 'text-accent'
                  : 'text-foreground/80'
            )}>
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [col, setCol]       = useState<string | null>(null)
  const [agent, setAgent]   = useState<AgentId>('openclaw')

  useEffect(() => {
    setSkills(getSkills())
    syncSkillsFromApi().then(setSkills).catch(() => {})
  }, [])

  const collections = useMemo(() => {
    const m = new Map<string, number>()
    skills.forEach(s => (s.collections || []).forEach(c => m.set(c, (m.get(c) ?? 0) + 1)))
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
  }, [skills])

  const scopedCount = useMemo(() =>
    col ? skills.filter(s => (s.collections || []).includes(col)).length : skills.length,
    [skills, col]
  )

  const mcpUrl   = useMemo(() => buildUrl(col), [col])
  const agentDef = AGENTS.find(a => a.id === agent)!
  const config   = useMemo(() => agentDef.generate(mcpUrl), [agentDef, mcpUrl])

  return (
    <>
      <TopBar showFab={false} />

      <style>{`
        @keyframes riseIn    { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }
        @keyframes slideDown { from { opacity:0; transform:translateY(-5px) scale(.99) } to { opacity:1; transform:none } }
        @keyframes slideUp   { from { opacity:0; transform:translateY(5px) scale(.99) } to { opacity:1; transform:none } }
        @keyframes pulse     { 0%,100% { opacity:1 } 50% { opacity:.3 } }
        @keyframes fadeIn    { from { opacity:0 } to { opacity:1 } }

        .i-1 { animation: riseIn .35s cubic-bezier(.16,1,.3,1) both }
        .i-2 { animation: riseIn .35s cubic-bezier(.16,1,.3,1) .07s both }
        .i-3 { animation: riseIn .35s cubic-bezier(.16,1,.3,1) .13s both }
        .i-4 { animation: riseIn .35s cubic-bezier(.16,1,.3,1) .19s both }
        .cfg { animation: fadeIn .18s ease both }
        .scope-dd { animation: slideDown .12s ease both }
        .scope-dd-flip { animation: slideUp .12s ease both }
        .conn-pulse { animation: pulse 2.2s ease-in-out infinite }
      `}</style>

      <main className="flex-1 overflow-auto">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-6">

          {/* ── header ───────────────────────────────────────────────── */}
          <div className="i-1 flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="text-lg font-semibold text-foreground">MCP Integrations</h1>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Connect your AI agents via MCP · HTTP · JSON-RPC 2.0
              </p>
            </div>
          </div>

          {/* ── scope selector ───────────────────────────────────────── */}
          <div className="i-2 mb-5">
            <ScopeSelector
              collections={collections}
              totalSkills={skills.length}
              value={col}
              onChange={setCol}
            />
          </div>

          {/* ── two-column: config + connections ─────────────────────── */}
          <div className="i-3 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start mb-5">

            {/* config */}
            <div className="cfg" key={agent + (col ?? '_')}>
              <ConfigPanel
                agent={agent}
                setAgent={setAgent}
                config={config}
                agentDef={agentDef}
                mcpUrl={mcpUrl}
              />
            </div>

            {/* connections */}
            <ConnectionsPanel />

          </div>

          {/* ── session status ────────────────────────────────────────── */}
          <div className="i-4">
            <SessionStatus
              mcpUrl={mcpUrl}
              agentLabel={agentDef.label}
              skillCount={scopedCount}
              scopeLabel={col}
            />
          </div>

        </div>
      </main>
    </>
  )
}
