'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Check, Search, ChevronDown, X, Wifi, WifiOff, Clock, Users, Radio, Activity, ChevronRight, ArrowUpDown, FolderOpen, Layers } from 'lucide-react'
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
  id: string; connected_at: number; duration_seconds: number; last_seen: number
  user_agent: string; remote: string; scope: string | null
  client_name: string; client_version: string; proto_version: string; call_count: number
}
type McpStatus = {
  status: 'online' | 'offline'; uptime_seconds: number
  active_connections: number; connections: McpConnection[]
}

// ─── agent resolution ─────────────────────────────────────────────────────────

// Maps a normalized category key → display label + dot color
const AGENT_CATALOG: Record<string, { label: string; color: string }> = {
  'claude-code': { label: 'Claude Code', color: '#8B5CF6' },
  openclaw:      { label: 'OpenClaw',    color: '#A855F7' },
  cursor:        { label: 'Cursor',      color: '#06B6D4' },
  openhands:     { label: 'OpenHands',   color: '#F59E0B' },
  codex:         { label: 'Codex',       color: '#10B981' },
  cline:         { label: 'Cline',       color: '#3B82F6' },
  windsurf:      { label: 'Windsurf',    color: '#14B8A6' },
  python:        { label: 'Python',      color: '#EAB308' },
  node:          { label: 'Node.js',     color: '#84CC16' },
  curl:          { label: 'curl',        color: '#6B7280' },
  other:         { label: 'Other',       color: '#6B7280' },
}

function categorize(s: string): string {
  const n = s.toLowerCase()
  if (n.includes('claude'))    return 'claude-code'
  if (n.includes('openclaw'))  return 'openclaw'
  if (n.includes('cursor'))    return 'cursor'
  if (n.includes('openhands')) return 'openhands'
  if (n.includes('codex'))     return 'codex'
  if (n.includes('cline'))     return 'cline'
  if (n.includes('windsurf'))  return 'windsurf'
  if (n.includes('python') || n.includes('httpx') || n.includes('requests')) return 'python'
  if (n.includes('node') || n.includes('axios') || n.includes('undici'))     return 'node'
  if (n.includes('curl'))      return 'curl'
  return 'other'
}

function parseUaVersion(ua: string): string {
  const m = ua.match(/[/@ ](\d+\.\d+[\d.]*)/)
  return m ? m[1] : ''
}

function resolveAgent(conn: McpConnection) {
  // MCP clientInfo is authoritative; fall back to UA sniffing
  const primary   = conn.client_name || conn.user_agent
  const category  = categorize(primary)
  const cat       = AGENT_CATALOG[category] ?? AGENT_CATALOG.other
  const name      = conn.client_name ? conn.client_name : cat.label
  const version   = conn.client_version || parseUaVersion(conn.user_agent)
  return { category, label: cat.label, color: cat.color, name, version }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(s: number) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
function fmtUptime(s: number) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return m ? `${h}h ${m}m` : `${h}h`
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
      {/* label row */}
      <div className="flex items-center gap-1.5 mb-2">
        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground/40" />
        <span className="text-[12px] font-medium text-muted-foreground/55">Filter by collection</span>
        {value && (
          <span className="ml-auto text-[11px] text-accent/60 font-medium">filtered</span>
        )}
      </div>

      {/* trigger */}
      <button
        ref={triggerRef}
        onClick={() => open ? setOpen(false) : openDrop()}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all duration-150 focus:outline-none cursor-pointer',
          open
            ? 'border-accent/50 bg-accent/3 ring-2 ring-accent/10 shadow-sm'
            : value
              ? 'border-accent/30 bg-accent/3 hover:border-accent/50 hover:bg-accent/5 shadow-sm'
              : 'border-border bg-card hover:border-border/80 hover:bg-muted/30 hover:shadow-sm'
        )}
      >
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <div className={cn(
            'w-2 h-2 rounded-full shrink-0 transition-colors duration-200',
            value ? 'bg-accent' : 'bg-muted-foreground/30'
          )} />
          <div className="flex flex-col min-w-0">
            <span className={cn(
              'text-[13px] font-medium truncate leading-snug',
              value ? 'text-foreground' : 'text-foreground/70'
            )}>
              {value ?? 'All Skills'}
            </span>
            {!value && (
              <span className="text-[11px] text-muted-foreground/35">
                click to filter by collection
              </span>
            )}
          </div>
          {value && (
            <span className="text-[11px] text-muted-foreground/40 truncate hidden sm:block shrink-0">
              collection
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className={cn(
            'text-[12px] tabular-nums transition-colors duration-150',
            value ? 'text-accent/70 font-semibold' : 'text-muted-foreground/50'
          )}>
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
            'h-4 w-4 transition-transform duration-200',
            open ? 'text-accent rotate-180' : 'text-muted-foreground/50'
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

// ─── scope chip ───────────────────────────────────────────────────────────────

function ScopeChip({ scope, highlight }: { scope: string | null; highlight: boolean }) {
  const isAll = !scope
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 transition-all duration-150',
      isAll
        ? 'bg-muted/60 text-muted-foreground/40'
        : highlight
          ? 'bg-accent/15 text-accent border border-accent/20'
          : 'bg-muted/60 text-accent/60'
    )}>
      <Layers className="h-2.5 w-2.5 shrink-0" />
      {isAll ? 'All Skills' : scope}
    </span>
  )
}

// ─── connection row ───────────────────────────────────────────────────────────

function ConnRow({ conn, elapsed, selectedScope }: {
  conn: McpConnection; elapsed: number; selectedScope: string | null
}) {
  const { name, version, color } = resolveAgent(conn)
  const duration = fmtDuration(conn.duration_seconds + elapsed)
  const calls = conn.call_count ?? 0
  // Dim rows that don't match the scope the user is currently viewing
  const scopeMatch = !selectedScope || conn.scope === selectedScope
  return (
    <div className={cn(
      'flex items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-all duration-150 group',
      !scopeMatch && 'opacity-35 hover:opacity-60'
    )}>
      {/* emerald = session is alive — consistent with the header count badge */}
      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 conn-pulse" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {/* category color on the name dot so agent type is still visible */}
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="text-[13px] font-medium text-foreground truncate leading-snug">{name}</span>
          {version && (
            <span className="text-[10.5px] font-mono text-muted-foreground/35 shrink-0">v{version}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1 min-w-0 flex-wrap">
          {/* scope chip — always shown, "All Skills" when unscoped */}
          <ScopeChip scope={conn.scope} highlight={!!(selectedScope && conn.scope === selectedScope)} />
          <span className="text-muted-foreground/20 shrink-0">·</span>
          <span className="text-[11px] font-mono text-muted-foreground/40 shrink-0">{conn.remote}</span>
          {conn.proto_version && (
            <>
              <span className="text-muted-foreground/15 shrink-0 hidden sm:inline">·</span>
              <span className="text-[10px] font-mono text-muted-foreground/20 hidden sm:inline shrink-0">MCP {conn.proto_version}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <div className="flex items-center gap-1 text-muted-foreground/40">
          <Clock className="h-3 w-3" />
          <span className="text-[11px] font-mono tabular-nums">{duration}</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground/25 group-hover:text-muted-foreground/40 transition-colors">
          <Activity className="h-2.5 w-2.5" />
          <span className="text-[10.5px] font-mono tabular-nums">{calls} calls</span>
        </div>
      </div>
    </div>
  )
}

// ─── group section ────────────────────────────────────────────────────────────

function GroupSection({ category, conns, elapsed, open, onToggle, selectedScope }: {
  category: string; conns: McpConnection[]; elapsed: number
  open: boolean; onToggle: () => void; selectedScope: string | null
}) {
  const cat = AGENT_CATALOG[category] ?? AGENT_CATALOG.other
  const totalCalls = conns.reduce((s, c) => s + (c.call_count ?? 0), 0)
  const matchCount = selectedScope ? conns.filter(c => c.scope === selectedScope).length : conns.length
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-5 py-2.5 bg-muted/20 hover:bg-muted/30 transition-colors border-b border-border/20 text-left"
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
        <span className="flex-1 text-[12px] font-semibold text-foreground/70">{cat.label}</span>
        {selectedScope && matchCount > 0 && (
          <span className="text-[10px] font-medium text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded tabular-nums">
            {matchCount} on {selectedScope}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground/40 tabular-nums">{conns.length} total</span>
        {totalCalls > 0 && (
          <span className="text-[10.5px] text-muted-foreground/25 tabular-nums hidden sm:block">{totalCalls} calls</span>
        )}
        <ChevronRight className={cn(
          'h-3.5 w-3.5 text-muted-foreground/30 transition-transform duration-150',
          open && 'rotate-90'
        )} />
      </button>
      {open && (
        <div className="divide-y divide-border/20">
          {conns.map(c => <ConnRow key={c.id} conn={c} elapsed={elapsed} selectedScope={selectedScope} />)}
        </div>
      )}
    </div>
  )
}

// ─── live connections panel ───────────────────────────────────────────────────

function ConnectionsPanel({ selectedScope }: { selectedScope: string | null }) {
  const [status, setStatus]     = useState<McpStatus | null>(null)
  const [error, setError]       = useState(false)
  const [lastPoll, setLastPoll] = useState<number | null>(null)
  const [, setTick]             = useState(0)
  const [q, setQ]               = useState('')
  const [sort, setSort]         = useState<'duration' | 'calls'>('duration')
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

  const poll = async () => {
    try {
      const res = await fetch(`${buildMcpBase()}/status`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) throw new Error()
      const data: McpStatus = await res.json()
      setStatus(data)
      setError(false)
      // auto-open all groups on first load
      setOpenGroups(prev => {
        if (prev.size > 0) return prev
        const cats = new Set(data.connections.map(c => resolveAgent(c).category))
        return cats
      })
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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const online           = !error && status !== null
  const elapsedSincePoll = lastPoll ? Math.floor((Date.now() - lastPoll) / 1000) : 0

  // Filtered + sorted flat list
  const sorted = useMemo(() => {
    if (!online || !status) return []
    let conns = status.connections
    if (q) {
      const lq = q.toLowerCase()
      conns = conns.filter(c => {
        const { name, version } = resolveAgent(c)
        return (
          name.toLowerCase().includes(lq) ||
          version.includes(lq) ||
          c.remote.includes(lq) ||
          (c.scope ?? '').toLowerCase().includes(lq) ||
          c.user_agent.toLowerCase().includes(lq)
        )
      })
    }
    return [...conns].sort((a, b) =>
      sort === 'calls'
        ? (b.call_count ?? 0) - (a.call_count ?? 0)
        : (b.duration_seconds + elapsedSincePoll) - (a.duration_seconds + elapsedSincePoll)
    )
  }, [status, q, sort, online, elapsedSincePoll])

  // Groups (category → connections), sorted by group size desc
  const groups = useMemo(() => {
    const map = new Map<string, McpConnection[]>()
    sorted.forEach(c => {
      const { category } = resolveAgent(c)
      if (!map.has(category)) map.set(category, [])
      map.get(category)!.push(c)
    })
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [sorted])

  // Agent distribution for the stats strip
  const stats = useMemo(() => {
    if (!status) return []
    const map = new Map<string, number>()
    status.connections.forEach(c => {
      const { category } = resolveAgent(c)
      map.set(category, (map.get(category) ?? 0) + 1)
    })
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([cat, count]) => ({
      cat, count, color: (AGENT_CATALOG[cat] ?? AGENT_CATALOG.other).color,
      label: (AGENT_CATALOG[cat] ?? AGENT_CATALOG.other).label,
    }))
  }, [status])

  // Auto-group when many connections and no search active
  const useGrouped = sorted.length > 8 && !q

  const toggleGroup = (cat: string) =>
    setOpenGroups(prev => { const s = new Set(prev); s.has(cat) ? s.delete(cat) : s.add(cat); return s })

  return (
    <div className="bg-card border border-border/40 rounded-2xl overflow-hidden flex flex-col h-full">

      {/* ── header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[13px] font-semibold text-foreground shrink-0">Live Connections</span>
          {online && status!.active_connections > 0 && (
            <span className="inline-flex items-center h-5 px-1.5 rounded-md bg-emerald-500/10 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">
              {status!.active_connections}
            </span>
          )}
          {/* Context note — makes clear this panel is independent of the scope filter */}
          {online && selectedScope && status!.active_connections > 0 ? (
            <span className="text-[11px] text-muted-foreground/40 truncate hidden sm:block">
              {status!.connections.filter(c => c.scope === selectedScope).length} on &ldquo;{selectedScope}&rdquo;
              {' · '}
              {status!.connections.filter(c => !c.scope).length} on all skills
            </span>
          ) : online && status!.active_connections > 0 ? (
            <span className="text-[11px] text-muted-foreground/30 hidden sm:block">all scopes</span>
          ) : null}
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

      {/* ── agent distribution strip ─────────────────────────────────────── */}
      {online && stats.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 border-b border-border/25 bg-muted/10">
          {stats.map(s => (
            <span key={s.cat}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted/50 border border-border/30 text-[11px] select-none"
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-muted-foreground/60 font-medium">{s.label}</span>
              <span className="text-muted-foreground/35 tabular-nums font-mono">{s.count}</span>
            </span>
          ))}
        </div>
      )}

      {/* ── search + sort ────────────────────────────────────────────────── */}
      {online && status!.active_connections > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/30 bg-muted/5">
          <Search className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={`Search ${status!.active_connections} connections…`}
            className="flex-1 bg-transparent text-[12.5px] text-foreground placeholder:text-muted-foreground/30 outline-none min-w-0"
          />
          {q && (
            <button onClick={() => setQ('')} className="text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0">
              <X className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={() => setSort(s => s === 'duration' ? 'calls' : 'duration')}
            title={sort === 'duration' ? 'Sorted by duration — click for calls' : 'Sorted by calls — click for duration'}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-colors shrink-0"
          >
            <ArrowUpDown className="h-3 w-3" />
            <span className="hidden sm:inline">{sort === 'duration' ? 'duration' : 'calls'}</span>
          </button>
        </div>
      )}

      {/* ── body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: 480 }}>
        {!online ? (
          <div className="flex flex-col items-center gap-2.5 py-10 px-6">
            <div className="w-10 h-10 rounded-xl bg-muted/50 border border-border/30 flex items-center justify-center">
              <Radio className="h-4 w-4 text-muted-foreground/20" />
            </div>
            <p className="text-[13px] text-muted-foreground/50">MCP server not reachable</p>
            <p className="text-[11px] font-mono text-muted-foreground/25">{buildMcpBase()}/status</p>
          </div>
        ) : sorted.length === 0 && !q ? (
          <div className="flex flex-col items-center gap-2.5 py-10 px-6">
            <div className="w-10 h-10 rounded-xl bg-muted/50 border border-border/30 flex items-center justify-center">
              <Users className="h-4 w-4 text-muted-foreground/20" />
            </div>
            <p className="text-[13px] text-muted-foreground/50">No agents connected</p>
            <p className="text-[11px] text-muted-foreground/30">Connect using the config on the left</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-muted-foreground/40">
            No connections match &ldquo;{q}&rdquo;
          </div>
        ) : useGrouped ? (
          // ── grouped view (auto-triggered for 8+ connections) ──
          <div className="divide-y divide-border/20">
            {groups.map(([cat, conns]) => (
              <GroupSection
                key={cat}
                category={cat}
                conns={conns}
                elapsed={elapsedSincePoll}
                open={openGroups.has(cat)}
                onToggle={() => toggleGroup(cat)}
                selectedScope={selectedScope}
              />
            ))}
          </div>
        ) : (
          // ── flat view ──
          <div className="divide-y divide-border/20">
            {sorted.map(c => <ConnRow key={c.id} conn={c} elapsed={elapsedSincePoll} selectedScope={selectedScope} />)}
          </div>
        )}
      </div>

      {/* ── footer ──────────────────────────────────────────────────────── */}
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
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 conn-pulse" />
          <span className="text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400">ready</span>
        </div>
      </div>
      {/* vertical stack — fits 340px sidebar cleanly */}
      <div className="divide-y divide-border/25">
        {items.filter(i => !('emerald' in i && i.emerald)).map((item, i) => (
          <div key={i} className="flex items-center justify-between px-5 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/35">
              {item.label}
            </span>
            <span className={cn(
              'text-[12.5px] font-medium text-right',
              'accent' in item && item.accent ? 'text-accent' : 'text-foreground/75'
            )}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
      {/* MCP URL footer */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-t border-border/25 bg-muted/10">
        <code className="flex-1 text-[10.5px] font-mono text-muted-foreground/35 truncate min-w-0">{mcpUrl}</code>
        <CopyBtn text={mcpUrl} label="Copy" size="sm" />
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

          {/* ── two-column: config + session ─────────────────────────── */}
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

            {/* session — fits neatly in the sidebar width */}
            <SessionStatus
              mcpUrl={mcpUrl}
              agentLabel={agentDef.label}
              skillCount={scopedCount}
              scopeLabel={col}
            />

          </div>

          {/* ── live connections — full width so 100+ connections have room ── */}
          <div className="i-4">
            <ConnectionsPanel selectedScope={col} />
          </div>

        </div>
      </main>
    </>
  )
}
