import { intro, log, note, outro, spinner } from '@clack/prompts'
import open from 'open'
import { runBridgeLoop } from '../bridge/poll.js'
import {
  type ComposeOptions,
  composePull,
  composeUp,
  ensureComposeExtracted,
} from '../docker/compose.js'
import { waitForHealthy } from '../docker/health.js'
import { composeVersion, isProjectRunning, requireDocker } from '../docker/inspect.js'
import { pkgInfo } from '../lib/package-info.js'
import { checkPorts } from '../lib/ports.js'
import { isInteractive } from '../lib/system.js'
import { checkForUpdate } from '../lib/update-check.js'
import { loadConfig } from '../state/config.js'
import { LockHeldError, acquireLock } from '../state/lockfile.js'
import { loadState, newSessionToken, updateState } from '../state/state.js'
import { compactBanner, welcomeBanner } from '../ui/banner.js'
import { UserFacingError, prettyError } from '../ui/errors.js'
import { urlTable } from '../ui/table.js'
import { c } from '../ui/theme.js'

export interface StartOptions {
  webPort?: number
  apiPort?: number
  // Commander's --no-X flags become opts.X with default true.
  pull?: boolean
  browser?: boolean
  detach?: boolean
  /** Override an alive-but-stale lock (R9 F26/F34). */
  force?: boolean
}

/** Compute how old a lock is, in hours, given its `startedAt` timestamp. */
function lockAgeHours(startedAt: string): number | null {
  const t = Date.parse(startedAt)
  if (Number.isNaN(t)) return null
  return Math.round((Date.now() - t) / 36e5)
}

export async function startCommand(opts: StartOptions = {}): Promise<void> {
  const version = pkgInfo.version
  const state = await loadState()
  const config = await loadConfig()

  const webPort = opts.webPort ?? config.webPort
  const apiPort = opts.apiPort ?? config.apiPort

  // ─── Banner ────────────────────────────────────────────────────────────
  if (!state.seenWelcome) {
    process.stdout.write(`\n${welcomeBanner(version)}\n\n`)
  } else {
    // Kick off the update check in the background; we'll join later.
    const updateP = config.updateCheck
      ? checkForUpdate(pkgInfo.name, version)
      : Promise.resolve(null)
    const update = await updateP.catch(() => null)
    process.stdout.write(`\n${compactBanner(version, update ?? undefined)}\n\n`)
    if (update) {
      await updateState({ pendingUpdate: update, lastUpdateCheck: new Date().toISOString() })
    }
  }

  // ─── Lock ──────────────────────────────────────────────────────────────
  let release: () => Promise<void>
  try {
    release = await acquireLock(version, { force: opts.force === true })
  } catch (err) {
    if (err instanceof LockHeldError) {
      const ageHours = lockAgeHours(err.startedAt)
      const likelyHung = ageHours !== null && ageHours >= 2
      // R9 F26/F34: when the lock is hours-old, surface the PID + age + the
      // exact kill command so the user has a concrete next action, not just
      // "delete a file you've never heard of."
      const remediation = likelyHung
        ? [
            `The holding process has been alive for ${ageHours}h — it's likely hung.`,
            `Inspect:   ps -p ${err.pid} -o pid,etime,command`,
            `Kill it:   kill ${err.pid}`,
            `Or force:  skillnote start --force`,
          ]
        : [
            'Wait for the other process to finish,',
            'or run `skillnote stop` to shut it down,',
            `or force-override:  skillnote start --force  (PID ${err.pid})`,
          ]
      throw new UserFacingError({
        header: 'Another skillnote process is already running',
        body: `pid ${err.pid}, started ${err.startedAt}${ageHours !== null ? ` (${ageHours}h ago)` : ''}`,
        remediation,
      })
    }
    throw err
  }

  // Tear down cleanly on any signal so we don't leave a stale lock.
  const sigHandlers = installSignalHandlers(release)

  try {
    intro(c.brandBold('Starting SkillNote'))

    // ─── Prerequisite check ───────────────────────────────────────────────
    const prereq = spinner()
    prereq.start('Checking prerequisites')

    const dockerVersion = await requireDocker()
    prereq.message(`Docker daemon ${c.dim(`(${dockerVersion})`)}`)

    const composeV = await composeVersion()
    if (!composeV) {
      throw new UserFacingError({
        header: 'docker compose v2 not found',
        body: 'SkillNote requires `docker compose` (v2). The legacy `docker-compose` binary is not supported.',
        remediation: 'Install or upgrade Docker Desktop, or install the compose plugin.',
        docsUrl: 'https://docs.docker.com/compose/install/',
      })
    }

    // If our own compose project is already up, the ports are bound by us —
    // skip the host-port pre-check (which on macOS Docker Desktop sometimes
    // misses gvproxy's IPv6 dual-stack binds) and let `compose up` be
    // idempotent. See #41.
    const alreadyUp = await isProjectRunning()
    if (!alreadyUp) {
      const ports = await checkPorts([
        { service: 'web', port: webPort },
        { service: 'api', port: apiPort },
      ])
      const conflict = ports.find((p) => !p.free)
      if (conflict) {
        throw new UserFacingError({
          header: `Port ${conflict.port} (${conflict.service}) is in use`,
          body: 'Another process is already listening on that port.',
          remediation: [
            `Find it:    lsof -i :${conflict.port}`,
            `Override:   skillnote start --${conflict.service}-port <free port>`,
          ],
        })
      }
    }

    prereq.stop(`Prerequisites ${c.ok('ok')}`)

    // ─── Compose extraction ───────────────────────────────────────────────
    const composeFile = await ensureComposeExtracted(version)
    const composeOpts: ComposeOptions = {
      composeFile,
      env: {
        SKILLNOTE_WEB_PORT: String(webPort),
        SKILLNOTE_API_PORT: String(apiPort),
      },
    }

    // ─── Pull ────────────────────────────────────────────────────────────
    if (opts.pull !== false) {
      const pullSpin = spinner()
      pullSpin.start('Pulling images')
      let lastLine = ''
      await composePull(composeOpts, (line) => {
        // Show only meaningful lines (no JSON spam) and the latest one.
        if (line.length > 100) return
        if (line.startsWith(' ') || line.startsWith('[+]') || line.includes('Pull')) {
          lastLine = line.trim()
          pullSpin.message(`Pulling images ${c.dim(`· ${lastLine}`)}`)
        }
      })
      pullSpin.stop(`Images pulled ${c.ok('ok')}`)
    }

    // ─── Up ──────────────────────────────────────────────────────────────
    const upSpin = spinner()
    upSpin.start('Starting containers')
    await composeUp(composeOpts, (line) => {
      const trimmed = line.trim()
      if (trimmed.length > 0 && trimmed.length < 80) {
        upSpin.message(`Starting containers ${c.dim(`· ${trimmed}`)}`)
      }
    })
    upSpin.stop(`Containers ${c.ok('running')}`)

    // ─── Health ──────────────────────────────────────────────────────────
    const healthSpin = spinner()
    healthSpin.start('Waiting for services to become healthy')
    const finalSnap = await waitForHealthy(composeOpts, ['postgres', 'api', 'web'], {
      onUpdate: (snap) => {
        const pending = snap.filter(
          (s) => s.health !== 'healthy' && !(s.state === 'running' && s.health === 'unknown'),
        )
        if (pending.length > 0) {
          healthSpin.message(`Waiting ${c.dim(`· ${pending.map((s) => s.service).join(', ')}`)}`)
        }
      },
    })
    const unhealthy = finalSnap.filter(
      (s) => s.health === 'unhealthy' || (s.state !== 'running' && s.health !== 'healthy'),
    )
    if (unhealthy.length > 0) {
      throw new UserFacingError({
        header: 'Some services failed to start',
        body: unhealthy.map((s) => `${s.service}: ${s.status}`),
        remediation: `Run \`skillnote logs ${unhealthy[0]?.service}\` to see why.`,
      })
    }
    healthSpin.stop(`Services ${c.ok('healthy')}`)

    // ─── URL summary ─────────────────────────────────────────────────────
    // R9 F28/F43: the published web image has `NEXT_PUBLIC_API_BASE_URL`
    // baked into the bundle at IMAGE BUILD time. Overriding `--api-port`
    // at runtime won't reach the browser without help; AND if the user
    // previously ran with `--api-port 8092` and now runs on defaults,
    // the stale `localStorage['skillnote:api-url']=...:8092` keeps the
    // browser pointing at the dead override.
    //
    // Resolution: ALWAYS auto-open `?api=<resolved>` so a synchronous
    // <head> script in the web bundle reconciles localStorage to whatever
    // this `skillnote start` invocation actually started. The terminal
    // table shows the clean URL so docs/screenshots stay readable; the
    // `openUrl` below is what the auto-open + first-bite browser hits.
    const cleanWebUrl = `http://localhost:${webPort}`
    const openUrl = `${cleanWebUrl}/?api=${encodeURIComponent(`http://localhost:${apiPort}`)}`
    process.stdout.write('\n')
    process.stdout.write(
      urlTable([
        { label: 'Web UI', url: apiPort === 8082 ? cleanWebUrl : openUrl },
        { label: 'API   ', url: `http://localhost:${apiPort}` },
        { label: 'Health', url: `http://localhost:${apiPort}/health` },
      ]),
    )
    process.stdout.write('\n')

    // First-run state: mark seenWelcome + initialize session token.
    await updateState({
      seenWelcome: true,
      lastStart: new Date().toISOString(),
      firstStart: state.firstStart ?? new Date().toISOString(),
      totalStarts: state.totalStarts + 1,
      cliSessionToken: state.cliSessionToken ?? newSessionToken(),
    })

    // ─── Browser ─────────────────────────────────────────────────────────
    if (opts.browser !== false && config.browserMode !== 'none') {
      // First run auto-opens. Always uses the `?api=…` form (R9 F43) so any
      // stale localStorage override from a previous `--api-port` invocation
      // gets reconciled. The bootstrap script strips the param post-paint.
      if (!state.seenWelcome) {
        await open(openUrl).catch(() => undefined)
      }
    }

    // ─── Outro ───────────────────────────────────────────────────────────
    if (opts.detach || !isInteractive()) {
      outro(`${c.ok('SkillNote is running.')} Run ${c.brand('skillnote stop')} to shut down.`)
      return
    }

    note(
      [
        `${c.bold('o')}  open in browser`,
        `${c.bold('s')}  show status`,
        `${c.bold('q')}  quit (containers keep running — use ${c.brand('skillnote stop')} to shut down)`,
      ].join('\n'),
      'Controls',
    )

    // Background: the Web ↔ CLI bridge. Polls the running API for jobs the
    // browser dispatched (e.g., "connect this agent") and executes them here.
    const bridgeAbort = new AbortController()
    const bridgePromise = runBridgeLoop({
      apiBase: `http://localhost:${apiPort}`,
      signal: bridgeAbort.signal,
      onLog: (msg) => log.message(c.dim(msg)),
    }).catch(() => undefined)

    try {
      await keypressLoop({ webPort, composeOpts })
    } finally {
      bridgeAbort.abort()
      await bridgePromise
    }

    outro(
      `${c.ok('Detached.')} Containers still running. Run ${c.brand('skillnote stop')} to shut down.`,
    )
  } catch (err) {
    if (err instanceof UserFacingError) {
      process.stderr.write(`\n${prettyError(err.options)}`)
      process.exitCode = 1
    } else {
      throw err
    }
  } finally {
    sigHandlers.uninstall()
    await release()
  }
}

interface KeypressOpts {
  webPort: number
  composeOpts: ComposeOptions
}

async function keypressLoop({ webPort }: KeypressOpts): Promise<void> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve()
      return
    }
    const stdin = process.stdin
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    const onKey = (data: string) => {
      if (data === 'o') {
        log.info(`Opening http://localhost:${webPort}`)
        open(`http://localhost:${webPort}`).catch(() => undefined)
      } else if (data === 's') {
        log.info('Run `skillnote status` in another shell for the full status table.')
      } else if (data === 'q' || data === '\x03' /* Ctrl+C */) {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.removeListener('data', onKey)
        resolve()
      }
    }
    stdin.on('data', onKey)
  })
}

interface SignalHandlers {
  uninstall: () => void
}

function installSignalHandlers(release: () => Promise<void>): SignalHandlers {
  let released = false
  const cleanup = async () => {
    if (released) return
    released = true
    try {
      await release()
    } catch {
      // best-effort
    }
  }
  const handler = (sig: NodeJS.Signals) => {
    cleanup().then(() => process.exit(sig === 'SIGINT' ? 130 : 143))
  }
  process.on('SIGINT', handler)
  process.on('SIGTERM', handler)
  process.on('SIGHUP', handler)
  return {
    uninstall: () => {
      process.off('SIGINT', handler)
      process.off('SIGTERM', handler)
      process.off('SIGHUP', handler)
    },
  }
}
