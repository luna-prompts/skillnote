/**
 * Web ↔ CLI bridge — CLI side.
 *
 * Long-polls the running SkillNote backend for jobs the web UI dispatched
 * (e.g., "connect claude-code"), executes them locally, and streams logs +
 * completion back.
 *
 * Runs as a background async task spawned from `skillnote start`. Exits
 * cleanly on SIGINT and when start's keypress loop ends.
 */
import { connectCommand } from '../commands/connect.js'
import { disconnectCommand } from '../commands/disconnect.js'
import { reconnectCommand } from '../commands/reconnect.js'
import { c } from '../ui/theme.js'

export interface BridgeJob {
  id: string
  type: 'connect' | 'disconnect' | 'reconnect' | 'open'
  agent: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
}

export interface BridgeOptions {
  apiBase: string
  pollTimeoutSeconds?: number
  // If set, the loop will exit when this signal aborts.
  signal?: AbortSignal
  // Hook for tests to drive timing without real network calls.
  onLog?: (msg: string) => void
}

export async function runBridgeLoop(opts: BridgeOptions): Promise<void> {
  const timeout = opts.pollTimeoutSeconds ?? 25
  while (!opts.signal?.aborted) {
    try {
      const job = await pollNext(opts.apiBase, timeout, opts.signal)
      if (!job) continue
      opts.onLog?.(`bridge: claimed job ${job.id} (${job.type} ${job.agent})`)
      await claim(opts.apiBase, job.id)
      await executeJob(job, opts)
    } catch (err) {
      // Network blips happen — backoff briefly and continue.
      if (opts.signal?.aborted) return
      opts.onLog?.(`bridge: poll error: ${(err as Error).message}`)
      await sleep(2_000, opts.signal)
    }
  }
}

async function pollNext(
  apiBase: string,
  timeoutSec: number,
  signal?: AbortSignal,
): Promise<BridgeJob | null> {
  const url = `${apiBase}/v1/cli/jobs/pending?timeout=${timeoutSec}`
  // Belt-and-braces client-side timeout: if the server fails to close the
  // long-poll within `timeoutSec + 5s`, the daemon would hang forever.
  // Layered on the parent signal so SIGINT still wins.
  const localCtl = new AbortController()
  const localTimer = setTimeout(() => localCtl.abort(), (timeoutSec + 5) * 1_000)
  const onParentAbort = () => localCtl.abort()
  signal?.addEventListener('abort', onParentAbort, { once: true })
  try {
    const res = await fetch(url, { signal: localCtl.signal })
    if (!res.ok) return null
    const body = (await res.json()) as BridgeJob | null
    return body
  } finally {
    clearTimeout(localTimer)
    signal?.removeEventListener('abort', onParentAbort)
  }
}

async function claim(apiBase: string, jobId: string): Promise<void> {
  await fetch(`${apiBase}/v1/cli/jobs/${jobId}/claim`, { method: 'POST' })
}

async function pushLog(apiBase: string, jobId: string, line: string): Promise<void> {
  await fetch(`${apiBase}/v1/cli/jobs/${jobId}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line }),
  }).catch(() => undefined)
}

async function pushDone(
  apiBase: string,
  jobId: string,
  exitCode: number,
  error?: string,
): Promise<void> {
  await fetch(`${apiBase}/v1/cli/jobs/${jobId}/done`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exit_code: exitCode, error }),
  }).catch(() => undefined)
}

async function executeJob(job: BridgeJob, opts: BridgeOptions): Promise<void> {
  opts.onLog?.(`bridge: executing ${c.brand(job.type)} ${c.brand(job.agent)}`)
  await pushLog(opts.apiBase, job.id, `Starting ${job.type} ${job.agent}...`)

  // Capture console output during execution and forward to the job log.
  const drain = captureConsole((msg) => pushLog(opts.apiBase, job.id, msg))
  try {
    if (job.type === 'connect') {
      await connectCommand(job.agent, { yes: true })
    } else if (job.type === 'disconnect') {
      await disconnectCommand(job.agent, { yes: true })
    } else if (job.type === 'reconnect') {
      await reconnectCommand(job.agent, { yes: true })
    } else if (job.type === 'open') {
      // 'open' is a noop here — the web UI surfaces the URL itself.
      await pushLog(opts.apiBase, job.id, 'open: handled by browser')
    }
    drain()
    const raw = process.exitCode
    const exitCode = typeof raw === 'number' ? raw : raw === undefined ? 0 : Number(raw) || 0
    await pushDone(opts.apiBase, job.id, exitCode)
    opts.onLog?.(`bridge: job ${job.id} ${exitCode === 0 ? c.ok('succeeded') : c.err('failed')}`)
    // Reset exitCode so subsequent jobs don't inherit a failure.
    if (exitCode !== 0) process.exitCode = 0
  } catch (err) {
    drain()
    await pushDone(opts.apiBase, job.id, 1, (err as Error).message)
    opts.onLog?.(`bridge: job ${job.id} ${c.err('errored')}: ${(err as Error).message}`)
  }
}

/**
 * Capture stdout/stderr writes during a job's execution and forward to the
 * remote job log. Returns a function that restores the original writers.
 */
function captureConsole(forward: (line: string) => void): () => void {
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)
  let buffer = ''
  const flush = (chunk: string | Uint8Array) => {
    buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    let nl = buffer.indexOf('\n')
    while (nl !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (line) forward(stripAnsi(line))
      nl = buffer.indexOf('\n')
    }
  }
  // biome-ignore lint/suspicious/noExplicitAny: stdout.write has multiple overloads
  process.stdout.write = ((chunk: any, ...rest: any[]) => {
    flush(chunk)
    return origOut(chunk, ...rest)
  }) as typeof process.stdout.write
  // biome-ignore lint/suspicious/noExplicitAny: stderr.write has multiple overloads
  process.stderr.write = ((chunk: any, ...rest: any[]) => {
    flush(chunk)
    return origErr(chunk, ...rest)
  }) as typeof process.stderr.write
  return () => {
    process.stdout.write = origOut
    process.stderr.write = origErr
    if (buffer) forward(stripAnsi(buffer))
  }
}

function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI sequences require control chars
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    signal?.addEventListener('abort', onAbort)
  })
}
