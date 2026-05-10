'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { useClipboard } from '@/lib/hooks'
import { getApiBaseUrl } from '@/lib/api/client'

type Status =
  | { kind: 'loading' }
  | { kind: 'connected'; lastIso: string }
  | { kind: 'idle' }
  | { kind: 'error' }

type UsageEvent = {
  id: string
  created_at: string
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function formatRelative(iso: string): string {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const ageMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (ageMin < 1) return rtf.format(0, 'minute')
  if (ageMin < 60) return rtf.format(-ageMin, 'minute')
  if (ageMin < 1440) return rtf.format(-Math.round(ageMin / 60), 'hour')
  return rtf.format(-Math.round(ageMin / 1440), 'day')
}

export function OpenClawSetupCard() {
  // Lazy initializer keeps this SSR-safe (`getApiBaseUrl` checks `typeof window`)
  // while avoiding a setState-in-effect that would trigger a cascading render.
  const [apiBase] = useState<string>(() => getApiBaseUrl())
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const { copied, copy } = useClipboard()

  const installCommand = useMemo(
    () => (apiBase ? `curl -sf ${apiBase}/setup/openclaw | bash` : ''),
    [apiBase],
  )

  // Probe the usage endpoint to determine connection status.
  useEffect(() => {
    if (!apiBase) return
    let cancelled = false
    const controller = new AbortController()

    const run = async () => {
      try {
        const res = await fetch(`${apiBase}/v1/openclaw/usage?limit=1`, {
          signal: controller.signal,
        })
        if (!res.ok) {
          if (!cancelled) setStatus({ kind: 'error' })
          return
        }
        const data: UsageEvent[] = await res.json()
        if (cancelled) return
        if (Array.isArray(data) && data.length > 0) {
          const latest = data[0]
          const ageMs = Date.now() - new Date(latest.created_at).getTime()
          if (ageMs <= SEVEN_DAYS_MS) {
            setStatus({ kind: 'connected', lastIso: latest.created_at })
            return
          }
        }
        setStatus({ kind: 'idle' })
      } catch {
        if (!cancelled) setStatus({ kind: 'error' })
      }
    }

    run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [apiBase])

  const handleCopy = () => {
    if (!installCommand) return
    copy(installCommand)
    toast.success('Copied install command')
  }

  return (
    <section className="mb-10">
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">
        OpenClaw Integration
      </h2>

      <p className="text-[13px] text-muted-foreground mb-4">
        Give your OpenClaw agent access to this SkillNote registry.
      </p>

      {/* Status indicator */}
      <div className="flex items-center gap-2 mb-5">
        <StatusDot status={status} />
        <span className="text-[13px] text-muted-foreground">
          <StatusText status={status} />
        </span>
      </div>

      {/* Install command */}
      <p className="text-[12px] font-medium text-muted-foreground mb-2">
        Install command
      </p>
      <div className="flex items-stretch gap-2 mb-5">
        <pre className="flex-1 min-w-0 bg-muted/40 border border-border/60 rounded-md px-3 py-2 text-[12px] font-mono text-foreground/85 leading-relaxed overflow-x-auto whitespace-nowrap select-all">
          {installCommand || ' '}
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!installCommand}
          aria-label="Copy install command"
          className={`shrink-0 inline-flex items-center gap-1.5 px-3 rounded-md border text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            copied
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
              : 'bg-background border-border text-foreground hover:bg-muted'
          }`}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* What gets installed */}
      <ul className="list-disc pl-5 space-y-1 text-[13px] text-muted-foreground mb-5">
        <li>Drops 2 skills into <span className="font-mono text-[12px]">~/.openclaw/skills/</span></li>
        <li>Writes config to <span className="font-mono text-[12px]">~/.openclaw/skillnote/config.json</span></li>
        <li>Asks for one-time confirmation before installing</li>
      </ul>

      {/* Learn more */}
      <Link
        href="/docs/openclaw-integration"
        className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
      >
        Learn more
        <ArrowRight className="h-3 w-3" />
      </Link>
    </section>
  )
}

function StatusDot({ status }: { status: Status }) {
  const cls =
    status.kind === 'connected'
      ? 'bg-green-500'
      : status.kind === 'error'
        ? 'bg-yellow-500'
        : status.kind === 'loading'
          ? 'bg-muted-foreground/40 animate-pulse'
          : 'bg-muted-foreground/40'
  return <span className={`h-2 w-2 rounded-full ${cls}`} aria-hidden />
}

function StatusText({ status }: { status: Status }) {
  switch (status.kind) {
    case 'loading':
      return <>Checking connection&hellip;</>
    case 'connected':
      return <>Connected (last activity: {formatRelative(status.lastIso)})</>
    case 'idle':
      return <>Not yet connected. Run the install command to wire up your OpenClaw agent.</>
    case 'error':
      return <>Status check failed (check your SkillNote backend is reachable).</>
  }
}
