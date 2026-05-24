'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/topbar'
import { approvePairing } from '@/lib/api/claude-ai'
import { SkillNoteApiError, apiRequest } from '@/lib/api/client'

type State =
  | { kind: 'waiting'; code: string }
  | { kind: 'approving'; code: string }
  | { kind: 'approved' }
  | { kind: 'error'; message: string }
  | { kind: 'missing-code' }
  | { kind: 'malformed-code'; provided: string }

// Must mirror backend `_PAIRING_CODE_ALPHABET` / `_PAIRING_CODE_LENGTH` in
// app/services/claude_ai_sync.py. Crockford-ish glyph set excludes 0/1/I/L/O/U
// to keep codes unambiguous when read aloud. If the backend pair alphabet
// changes, update this too — otherwise client validation diverges from server.
const PAIR_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/

// useSearchParams() requires a Suspense boundary in Next.js 16 for static
// rendering to work. Wrapping the inner content lets Next defer hydration
// of the search-params reader until the client takes over.
export default function PairApprovalPage() {
  return (
    <Suspense fallback={<TopBarOnlyFallback />}>
      <PairApprovalInner />
    </Suspense>
  )
}

function TopBarOnlyFallback() {
  return (
    <>
      <TopBar />
      <div className="mx-auto max-w-md px-6 py-16">
        <div className="rounded-lg border border-border bg-card p-6 text-center text-[13px] text-muted-foreground">
          Loading…
        </div>
      </div>
    </>
  )
}

function PairApprovalInner() {
  const router = useRouter()
  const params = useSearchParams()
  const code = (params?.get('code') ?? '').toUpperCase().trim()
  const [state, setState] = useState<State>(() => {
    if (!code) return { kind: 'missing-code' }
    if (!PAIR_CODE_PATTERN.test(code)) {
      return { kind: 'malformed-code', provided: code }
    }
    return { kind: 'waiting', code }
  })

  const approve = useCallback(async () => {
    if (state.kind !== 'waiting') return
    setState({ kind: 'approving', code: state.code })
    try {
      await approvePairing(state.code)
      // Mirror what the CLI install script does (backend/app/api/setup.py
      // _CLAUDE_AI_SETUP_SCRIPT pings /v1/setup/installs at the end). Without
      // this, web-paired browsers are invisible to the Connect page's
      // install counters — the agent looks "never installed."
      void apiRequest('/v1/setup/installs', {
        method: 'POST',
        body: JSON.stringify({ agent: 'claude-ai' }),
      }).catch(() => {
        // Telemetry is best-effort; never break the success path on it.
      })
      setState({ kind: 'approved' })
      toast.success('Browser approved — sync is starting')
      // Auto-redirect after a moment so the user lands back on the integration page.
      setTimeout(() => router.push('/settings/integrations/claude-ai'), 1500)
    } catch (e) {
      const msg = e instanceof SkillNoteApiError ? e.message : (e as Error).message
      setState({ kind: 'error', message: msg })
    }
  }, [router, state])

  return (
    <>
      <TopBar />
      <div className="mx-auto max-w-md px-6 py-16">
        <div className="rounded-lg border border-border bg-card p-6">
          {state.kind === 'missing-code' && (
            <Block
              icon={<XCircle className="h-6 w-6 text-red-500" />}
              title="No pairing code"
              body="Open the SkillNote extension and click 'Connect' to start the pairing flow."
            />
          )}

          {state.kind === 'malformed-code' && (
            <>
              <Block
                icon={<XCircle className="h-6 w-6 text-red-500" />}
                title="That pairing code doesn’t look right"
                body={
                  // Friendly explanation of the shape so users can spot
                  // typos themselves. The exact alphabet matches the
                  // backend's _PAIRING_CODE_ALPHABET.
                  `Codes are 6 characters from the alphabet ` +
                  `23456789ABCDEFGHJKMNPQRSTUVWXYZ. ` +
                  `You typed “${state.provided.slice(0, 32)}”.`
                }
              />
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => router.push('/settings/integrations/claude-ai')}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground hover:bg-muted"
                >
                  Back to settings
                </button>
              </div>
            </>
          )}

          {state.kind === 'waiting' && (
            <>
              <h1 className="text-[17px] font-semibold text-foreground">Approve browser pairing</h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                A browser is requesting permission to sync skills to your claude.ai account.
              </p>
              <div className="mt-5 rounded-md border border-dashed border-border bg-background px-4 py-3 text-center">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Pairing code</div>
                <div className="mt-1 font-mono text-[24px] tracking-[0.15em] text-foreground">{state.code}</div>
              </div>
              <p className="mt-4 text-[12px] text-muted-foreground">
                Approve only if this code matches what you see in your SkillNote browser extension. If it doesn't match, close this page.
              </p>
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => void approve()}
                  className="flex-1 rounded-md bg-foreground px-3 py-2 text-[13px] font-medium text-background hover:opacity-90"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/settings/integrations/claude-ai')}
                  className="rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {state.kind === 'approving' && (
            <Block
              icon={<Loader2 className="h-6 w-6 animate-spin text-blue-500" />}
              title="Approving…"
              body="Issuing extension token. This takes a second."
            />
          )}

          {state.kind === 'approved' && (
            <Block
              icon={<CheckCircle2 className="h-6 w-6 text-emerald-500" />}
              title="Browser approved"
              body="The extension is connected. Redirecting…"
            />
          )}

          {state.kind === 'error' && (
            <>
              <Block
                icon={<XCircle className="h-6 w-6 text-red-500" />}
                title="Approval failed"
                body={state.message}
              />
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => router.push('/settings/integrations/claude-ai')}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground hover:bg-muted"
                >
                  Back to settings
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Block({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <div>{icon}</div>
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}
