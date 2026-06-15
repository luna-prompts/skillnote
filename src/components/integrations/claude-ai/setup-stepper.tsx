'use client'

/**
 * Interactive 4-step setup stepper for non-technical users.
 *
 * Anatomy
 *   ┌───────────────────────────────────────────────────┐
 *   │ ① Install the SkillNote extension          [✓]   │  ← auto-completes from state
 *   │ ② Open the extension and paste this URL    [▸]   │  ← current step (expanded)
 *   │ ③ Approve the pairing code                       │
 *   │ ④ Sign in to claude.ai                            │
 *   └───────────────────────────────────────────────────┘
 *
 * State sources (in order of authority):
 *   - integrations.length > 0      → Steps 1-3 auto-complete
 *   - localStorage flag            → Step 1 manually marked (user clicked
 *                                     "I've installed it") before pairing
 *   - pending_approval row exists  → Step 2 auto-completes; step 3 active
 *
 * The user can manually mark steps complete to skip ahead, but the
 * stepper never lies about state derived from the backend.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Chrome,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { detectBrowser, type BrowserInfo } from '@/lib/browser-detect'
import { type IntegrationStatusResponse } from '@/lib/api/claude-ai'
import { getApiBaseUrl } from '@/lib/api/client'

const EXTENSION_SOURCE_URL =
  'https://github.com/luna-prompts/skillnote/tree/main/extensions/claude-ai'

// Per-backend storage key for the install-acknowledged flag. Without
// scoping, a user with two SkillNote instances (work + personal) who
// marks step 1 done on one would silently see it done on the other.
// The key is built from the API base URL so each backend gets its own
// flag bucket.
function installedFlagKey(apiBase: string): string {
  return `skillnote:claude-ai:install-acknowledged:${apiBase}`
}

interface Props {
  integrations: IntegrationStatusResponse[] | null
  onPairingApproved?: () => void
}

export function ClaudeAISetupStepper({ integrations, onPairingApproved }: Props) {
  const [browser, setBrowser] = useState<BrowserInfo | null>(null)
  const [manualStep1, setManualStep1] = useState(false)
  const [activeStep, setActiveStep] = useState<number>(1)
  // Track whether the user has manually navigated steps. Once they have,
  // stop auto-advancing on backend state changes so we don't yank them
  // away from where they're exploring. The auto-advance still runs ONCE
  // on initial mount so first-time visitors land on the right step.
  const userInteracted = useRef(false)

  // Detect browser + read the install-ack flag on mount. SSR can't see
  // navigator/localStorage, so we defer to effect.
  useEffect(() => {
    setBrowser(detectBrowser())
    try {
      const key = installedFlagKey(getApiBaseUrl())
      setManualStep1(localStorage.getItem(key) === '1')
    } catch {
      // SSR / private mode — flag stays false; user can re-toggle.
    }
  }, [])

  // ── derived state ────────────────────────────────────────────────────
  const hasAnyIntegration = (integrations?.length ?? 0) > 0
  const hasActiveIntegration = (integrations ?? []).some(
    (i) => i.status === 'active' || i.status === 'cookie_expired',
  )
  const pendingPair = (integrations ?? []).find(
    (i) => i.status === 'pending_approval',
  )

  // Step completion logic — explicit so future tweaks are obvious.
  const step1Done = manualStep1 || hasAnyIntegration
  const step2Done = pendingPair !== undefined || hasAnyIntegration
  const step3Done = hasActiveIntegration
  // Step 4 = "we've actually proved claude.ai is reachable" — only true
  // when at least one integration has a non-null last_sync_at. Without
  // this, the stepper showed all-green seconds after pairing even though
  // the first sync hadn't fired yet (so the user might think it works
  // when it doesn't).
  const step4Done = (integrations ?? []).some(
    (i) =>
      (i.status === 'active' || i.status === 'cookie_expired') &&
      i.last_sync_at !== null,
  )
  const allDone = step1Done && step2Done && step3Done && step4Done

  // Auto-advance to the first incomplete step — but ONLY before the user
  // has manually navigated. Once they click a step header we treat their
  // choice as authoritative until they hit "Restart setup" or the page
  // reloads.
  useEffect(() => {
    if (userInteracted.current) return
    if (!step1Done) setActiveStep(1)
    else if (!step2Done) setActiveStep(2)
    else if (!step3Done) setActiveStep(3)
    else if (!step4Done) setActiveStep(4)
    else setActiveStep(0) // collapsed when done
  }, [step1Done, step2Done, step3Done, step4Done])

  const handleStepClick = useCallback((n: number) => {
    userInteracted.current = true
    setActiveStep(n)
  }, [])

  // Reset progress: clears the install-ack flag AND re-enables
  // auto-advance so the stepper feels truly "fresh." Doesn't touch
  // backend state (paired integrations stay paired) — this is purely
  // a "I want the stepper to walk me through it again" affordance.
  const restartSetup = useCallback(() => {
    try {
      localStorage.removeItem(installedFlagKey(getApiBaseUrl()))
    } catch {
      // ignore
    }
    setManualStep1(false)
    userInteracted.current = false
    setActiveStep(1)
  }, [])

  const ackInstalled = useCallback(() => {
    try {
      localStorage.setItem(installedFlagKey(getApiBaseUrl()), '1')
    } catch {
      // ignore — flag is just a UX hint, not load-bearing
    }
    setManualStep1(true)
  }, [])

  if (allDone) {
    // Caller decides what to render in the "all set" state. The stepper
    // shows nothing — saves vertical space on the settings page.
    return null
  }

  // Safari can't run the extension at all. Replace the whole stepper
  // with a clear "switch browsers" banner — showing steps 2–4 below
  // an "unsupported" warning is worse than no instructions, because
  // it implies they're achievable in Safari.
  if (browser?.family === 'safari') {
    return <UnsupportedBrowserPanel browserLabel={browser.label} />
  }

  return (
    <div
      className="rounded-lg border border-border bg-card overflow-hidden"
      data-testid="claude-ai-setup-stepper"
    >
      <div className="border-b border-border bg-muted/30 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-background p-1.5">
            <Chrome className="h-4 w-4 text-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-semibold text-foreground tracking-tight">
              Connect claude.ai in 4 steps
            </h2>
            {/* Subtitle stays stable — it always says "Setup takes about a
                minute" so the first-paint shape doesn't shift. The detected
                browser appears as a small pill next to the title once
                detectBrowser() has run on the client. */}
            <p className="mt-0.5 text-[12px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
              <span>Setup takes about a minute.</span>
              {browser && (
                <span
                  className="inline-flex items-center gap-1 rounded bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground border border-border"
                  data-testid="detected-browser-badge"
                >
                  {browser.label}
                </span>
              )}
            </p>
          </div>
          <StepCounter
            done={[step1Done, step2Done, step3Done, step4Done].filter(Boolean).length}
            total={4}
          />
        </div>
      </div>

      <ol className="divide-y divide-border" data-testid="setup-step-list">
        <Step
          n={1}
          title="Install the SkillNote extension"
          done={step1Done}
          active={activeStep === 1}
          onActivate={() => handleStepClick(1)}
        >
          <Step1Body
            browser={browser}
            done={step1Done}
            onAcknowledge={ackInstalled}
          />
        </Step>

        <Step
          n={2}
          title="Open the extension and paste this URL"
          done={step2Done}
          active={activeStep === 2}
          onActivate={() => handleStepClick(2)}
        >
          <Step2Body />
        </Step>

        <Step
          n={3}
          title="Approve the pairing code"
          done={step3Done}
          active={activeStep === 3}
          onActivate={() => handleStepClick(3)}
        >
          <Step3Body
            pendingPair={pendingPair}
            onApproved={onPairingApproved}
          />
        </Step>

        <Step
          n={4}
          title="Sign in to claude.ai"
          done={step4Done}
          active={activeStep === 4}
          onActivate={() => handleStepClick(4)}
        >
          <Step4Body
            paired={hasActiveIntegration}
            firstSyncSeen={step4Done}
          />
        </Step>
      </ol>

      <Troubleshoot />

      {/* Footer affordance — collapses the stepper back to step 1 + clears
          the local "I've installed it" flag. Deliberately worded as
          "Reset stepper" (not "Restart setup") to make clear this is a
          UI affordance, not a factory-reset that would unpair browsers.
          Only renders once there's actual local progress to clear. */}
      {(manualStep1 || userInteracted.current) && (
        <div className="border-t border-border bg-muted/20 px-5 py-2.5 flex justify-end">
          <button
            type="button"
            onClick={restartSetup}
            className="text-[11.5px] text-muted-foreground hover:text-foreground transition-colors"
            title="Collapse the stepper back to step 1. Doesn’t unpair existing browsers."
          >
            Reset stepper
          </button>
        </div>
      )}
    </div>
  )
}

function Troubleshoot() {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="border-t border-border"
      data-testid="claude-ai-troubleshoot"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="claude-ai-troubleshoot-body"
        className="w-full flex items-center justify-between px-5 py-2.5 text-left text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
      >
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" />
          Stuck? Common fixes
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>
      {open && (
        <div
          id="claude-ai-troubleshoot-body"
          className="px-5 pb-4 pt-1 pl-[44px] space-y-3 text-[12px] text-muted-foreground leading-relaxed"
        >
          <FixItem title="The extension doesn’t show up after “Load unpacked”">
            Double-check you selected the{' '}
            <code className="rounded bg-muted px-1 text-[11px]">dist/</code>{' '}
            folder, not the parent. If <code className="rounded bg-muted px-1 text-[11px]">dist/</code>{' '}
            doesn’t exist, run{' '}
            <code className="rounded bg-muted px-1 text-[11px]">npm run build</code>{' '}
            again from{' '}
            <code className="rounded bg-muted px-1 text-[11px]">
              extensions/claude-ai/
            </code>
            .
          </FixItem>
          <FixItem title="I don’t see a SkillNote icon in the toolbar">
            Click the puzzle-piece icon next to the address bar. SkillNote
            is in that menu — click the pin icon next to its name so it
            stays in the toolbar.
          </FixItem>
          <FixItem title="The pairing code doesn’t appear">
            Make sure you clicked <strong>Connect</strong> (not
            <strong> Open settings</strong>) in the extension. The
            extension polls every few seconds, so allow up to 10 seconds
            for the code to show.
          </FixItem>
          <FixItem title="“Sign-in to claude.ai” still shows after I signed in">
            The extension reads cookies on its next sync tick. Wait one
            minute, or click <strong>Refresh</strong> at the top of the
            “Connected browsers” section.
          </FixItem>
          <FixItem title="Nothing syncs even though everything looks green">
            Confirm you’re signed in to claude.ai in the same browser
            profile where you loaded the extension. Incognito profiles
            don’t share extensions by default.
          </FixItem>
        </div>
      )}
    </div>
  )
}

function FixItem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-foreground/90 font-medium text-[12.5px]">{title}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  )
}

function UnsupportedBrowserPanel({ browserLabel }: { browserLabel: string }) {
  return (
    <div
      className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5"
      data-testid="claude-ai-unsupported-browser"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-amber-500/15 p-1.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1">
          <h2 className="text-[14px] font-semibold text-foreground tracking-tight">
            {browserLabel} can’t run the SkillNote extension yet
          </h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">
            The connector uses a browser extension that ships for
            Chromium-based browsers (Chrome, Edge, Brave, Arc) and Firefox.
            Open this page in one of those browsers to continue setup.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href="https://www.google.com/chrome/"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12.5px] font-medium text-background hover:opacity-90 transition-opacity"
            >
              Download Chrome
              <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href="https://www.mozilla.org/firefox/new/"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[12.5px] text-foreground hover:bg-muted transition-colors"
            >
              Download Firefox
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

function StepCounter({ done, total }: { done: number; total: number }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-[11px] font-medium tabular-nums text-muted-foreground border border-border"
      aria-label={`${done} of ${total} steps complete`}
    >
      <span className="text-foreground">{done}</span>
      <span className="text-muted-foreground/60">of {total}</span>
    </div>
  )
}

function Step({
  n,
  title,
  done,
  active,
  onActivate,
  children,
}: {
  n: number
  title: string
  done: boolean
  active: boolean
  onActivate: () => void
  children: React.ReactNode
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onActivate}
        aria-expanded={active}
        aria-controls={`setup-step-body-${n}`}
        className={cn(
          'group/step w-full flex items-center gap-3 px-5 py-3 text-left transition-colors',
          'hover:bg-muted/30 focus-visible:outline-none focus-visible:bg-muted/40',
          active && 'bg-muted/20',
        )}
      >
        <StepNumber n={n} done={done} active={active} />
        <span
          className={cn(
            'flex-1 text-[13px]',
            done ? 'text-muted-foreground line-through decoration-1' : 'text-foreground font-medium',
          )}
        >
          {title}
        </span>
        {active ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 group-hover/step:text-muted-foreground" />
        )}
      </button>
      {active && (
        <div
          id={`setup-step-body-${n}`}
          className="px-5 pb-5 pt-1 pl-[60px]"
          data-testid={`setup-step-${n}-body`}
        >
          {children}
        </div>
      )}
    </li>
  )
}

function StepNumber({
  n,
  done,
  active,
}: {
  n: number
  done: boolean
  active: boolean
}) {
  return (
    <span
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums transition-all',
        done
          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
          : active
            ? 'border-foreground bg-foreground text-background'
            : 'border-border bg-background text-muted-foreground',
      )}
      aria-hidden="true"
    >
      {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
    </span>
  )
}

// ── Step bodies ────────────────────────────────────────────────────────────

function Step1Body({
  browser,
  done,
  onAcknowledge,
}: {
  browser: BrowserInfo | null
  done: boolean
  onAcknowledge: () => void
}) {
  // Safari is handled at the stepper level (whole-stepper replaced) — by
  // the time Step1Body renders we know we're in a supported browser.
  const extUrl = browser?.extensionsUrl ?? 'chrome://extensions'
  const isFirefox = browser?.family === 'firefox'

  return (
    <div className="space-y-3 text-[12.5px] leading-relaxed">
      <p className="text-muted-foreground">
        Web Store and Firefox AMO listings are pending review. For now you’ll
        load the extension from source — about 60 seconds total.
      </p>

      <div className="rounded-md border border-border bg-background p-3 space-y-3">
        <SubStep n="a">
          <span>Clone the SkillNote repo, then build the extension:</span>
          <Snippet text="cd extensions/claude-ai && npm install && npm run build" />
        </SubStep>

        <SubStep n="b">
          {isFirefox ? (
            <>
              <span>
                Copy this URL and paste it into your address bar (Firefox blocks
                pages from opening <code className="rounded bg-muted px-1 text-[11px]">about:</code>{' '}
                URLs, so you can’t click a link):
              </span>
              <Snippet text="about:debugging#/runtime/this-firefox" />
              <p className="mt-1.5 text-muted-foreground">
                Click <strong>Load Temporary Add-on…</strong> and pick{' '}
                <code className="rounded bg-muted px-1 text-[11px]">
                  dist/manifest.json
                </code>{' '}
                from the folder you just built.
              </p>
            </>
          ) : (
            <>
              <span>
                Copy this URL and paste it into your address bar (browsers
                block web pages from opening <code className="rounded bg-muted px-1 text-[11px]">chrome://</code>{' '}
                URLs, so you have to do this manually):
              </span>
              <Snippet text={extUrl} />
              <p className="mt-1.5 text-muted-foreground">
                Enable <strong>Developer mode</strong> in the top right, then
                click <strong>Load unpacked</strong>.
              </p>
            </>
          )}
        </SubStep>

        <SubStep n="c">
          Pick the{' '}
          <code className="rounded bg-muted px-1 text-[11px]">
            extensions/claude-ai/dist
          </code>{' '}
          folder you just built.
        </SubStep>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <a
          href={EXTENSION_SOURCE_URL}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12.5px] font-medium text-background hover:opacity-90 transition-opacity"
        >
          Open repo on GitHub
          <ExternalLink className="h-3 w-3" />
        </a>
        {!done && (
          <button
            type="button"
            onClick={onAcknowledge}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Mark this step done and move on. You can still come back to it."
          >
            <Check className="h-3 w-3" />
            Mark step done
          </button>
        )}
      </div>
    </div>
  )
}

function Step2Body() {
  const [url, setUrl] = useState('')
  // Pair with the URL the user is already looking at — the web/UI origin, NOT
  // the backend API port. The web app proxies /v1/* to the backend, so this
  // works, and "localhost:8082" reads as a confusing wrong address to
  // non-technical users. window.location.origin is exactly what they typed in.
  useEffect(() => setUrl(window.location.origin), [])
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(url)
    toast.success('URL copied')
  }, [url])
  return (
    <div className="space-y-3 text-[12.5px] leading-relaxed">
      <p className="text-muted-foreground">
        After loading the extension it appears in the browser’s extension
        list. Open its settings:
      </p>
      <ol className="space-y-1 text-muted-foreground">
        <SubStep n="a">
          Click the <strong>puzzle-piece</strong> icon to the right of your
          address bar — it opens your installed extensions menu.
        </SubStep>
        <SubStep n="b">
          Find <strong>SkillNote</strong> in the menu and click it. (Tip:
          click the pin icon next to SkillNote so it stays in the toolbar.)
        </SubStep>
        <SubStep n="c">
          In the SkillNote popup, click <strong>Open settings</strong>.
        </SubStep>
        <SubStep n="d">
          Paste the URL below into the <em>SkillNote URL</em> field and click{' '}
          <strong>Connect</strong>.
        </SubStep>
      </ol>
      <div
        className="flex items-stretch gap-2 mt-2"
        data-testid="setup-step-2-url-row"
      >
        <code
          className="flex-1 min-w-0 truncate rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] text-foreground"
          data-testid="setup-skillnote-url"
          title={url}
        >
          {url || '…'}
        </code>
        <button
          type="button"
          onClick={copy}
          disabled={!url}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-[12px] text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          aria-label="Copy SkillNote URL"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy
        </button>
      </div>
    </div>
  )
}

function Step3Body({
  pendingPair,
  onApproved,
}: {
  pendingPair?: IntegrationStatusResponse
  onApproved?: () => void
}) {
  if (pendingPair) {
    return (
      <div className="space-y-3 text-[12.5px] leading-relaxed">
        <div
          className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2"
          data-testid="step-3-waiting-banner"
        >
          <Loader2 className="h-4 w-4 animate-spin text-blue-500 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">
              {pendingPair.browser_label ?? 'A browser'} is waiting for approval
            </p>
            <ol className="mt-1.5 space-y-0.5 text-muted-foreground list-decimal pl-4">
              <li>Look for the SkillNote tab the extension just opened.</li>
              <li>
                Compare the 6-character code shown there with the code in
                your extension popup.
              </li>
              <li>
                If they match, click the green <strong>Approve</strong>{' '}
                button on that tab.
              </li>
            </ol>
            <p className="mt-2 text-[11.5px] text-muted-foreground/80">
              This page updates within 10 seconds of approval.
            </p>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3 text-[12.5px] leading-relaxed">
      <p className="text-muted-foreground">
        After you click <strong>Connect</strong> in the extension, two
        things happen in parallel:
      </p>
      <ul className="space-y-1 list-disc pl-5 text-muted-foreground">
        <li>
          A new SkillNote tab opens automatically with a 6-character code
          and an <strong>Approve</strong> button.
        </li>
        <li>
          The extension popup shows the same code so you can compare them.
        </li>
      </ul>
      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-700 dark:text-amber-300">
        Approve only if the two codes match — otherwise close the page.
        This is the same safety check that defeats phishing attempts.
      </p>
    </div>
  )
}

function Step4Body({
  paired,
  firstSyncSeen,
}: {
  paired: boolean
  firstSyncSeen: boolean
}) {
  return (
    <div className="space-y-3 text-[12.5px] leading-relaxed">
      {paired && !firstSyncSeen && (
        // Honest in-between state: the extension is paired but no sync
        // has fired yet. Users would otherwise see "all green" without
        // actual proof that claude.ai is reachable from their browser.
        <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2">
          <Loader2 className="h-4 w-4 animate-spin text-blue-500 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-foreground">Waiting for first sync</p>
            <p className="mt-0.5 text-muted-foreground">
              The extension runs once a minute. If nothing happens after
              two minutes, make sure you’re signed in to claude.ai in
              this browser.
            </p>
          </div>
        </div>
      )}
      <p className="text-muted-foreground">
        Make sure you’re signed in to claude.ai in the same browser. Sync
        runs every minute as long as you stay signed in.
      </p>
      <a
        href="https://claude.ai"
        target="_blank"
        rel="noopener"
        className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12.5px] font-medium text-background hover:opacity-90 transition-opacity"
      >
        Open claude.ai
        <ArrowRight className="h-3.5 w-3.5" />
      </a>
    </div>
  )
}

function SubStep({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground/70 font-mono text-[11px] tabular-nums shrink-0 w-4">
        {n}.
      </span>
      <div className="min-w-0 flex-1 text-[12px] text-foreground/90 leading-relaxed">
        {children}
      </div>
    </div>
  )
}

function Snippet({ text }: { text: string }) {
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(text)
    toast.success('Copied')
  }, [text])
  return (
    <div className="mt-1.5 flex items-start gap-2 rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[11px] text-foreground">
      <code
        // Horizontal scroll instead of truncate: long commands are
        // visible end-to-end on narrow screens. whitespace-pre keeps the
        // exact spacing so the displayed text is byte-identical to what
        // the Copy button puts on the clipboard.
        className="flex-1 min-w-0 overflow-x-auto whitespace-pre py-0.5"
      >
        {text}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
        aria-label={`Copy: ${text}`}
        title="Copy to clipboard"
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  )
}
