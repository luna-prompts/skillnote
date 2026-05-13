import { intro, log, outro, spinner } from '@clack/prompts'
import { execa } from 'execa'
import { loadConfig } from '../state/config.js'
import { UserFacingError, prettyError } from '../ui/errors.js'
import { c } from '../ui/theme.js'

// Supported agent identifiers, matching the backend's /setup/agent dispatcher.
export const SUPPORTED_AGENTS = ['claude-code', 'openclaw'] as const
export type SupportedAgent = (typeof SUPPORTED_AGENTS)[number]

export interface ConnectOptions {
  yes?: boolean
}

const displayNames: Record<SupportedAgent, string> = {
  'claude-code': 'Claude Code',
  openclaw: 'OpenClaw',
}

export async function connectCommand(agent: string, _opts: ConnectOptions = {}): Promise<void> {
  try {
    if (!isSupported(agent)) {
      throw new UserFacingError({
        header: `Unknown agent: '${agent}'`,
        body: 'Supported agents:',
        remediation: SUPPORTED_AGENTS.map((a) => `  ${a} — ${displayNames[a]}`),
      })
    }

    const config = await loadConfig()
    const apiBase = config.host

    intro(c.brandBold(`Connecting ${displayNames[agent]}`))

    // ─── Reachability check ────────────────────────────────────────────────
    const reach = spinner()
    reach.start(`Reaching SkillNote API at ${c.dim(apiBase)}`)
    const ok = await pingApi(apiBase)
    if (!ok) {
      reach.stop(`API unreachable at ${apiBase}`, 1)
      throw new UserFacingError({
        header: 'SkillNote API not reachable',
        body: `Tried: ${apiBase}/health`,
        remediation: [
          'Make sure SkillNote is running:  skillnote status',
          'Or start it now:                 skillnote start',
        ],
      })
    }
    reach.stop('API reachable')

    // ─── Fetch + execute install script ────────────────────────────────────
    const fetchSpin = spinner()
    fetchSpin.start(`Fetching install script for ${agent}`)
    const script = await fetchInstallScript(apiBase, agent)
    fetchSpin.stop('Install script ready')

    const runSpin = spinner()
    runSpin.start(`Running install for ${agent}`)
    const result = await execa('bash', ['-s', '--', '--agent', agent], {
      input: script,
      reject: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, SKILLNOTE_API_BASE: apiBase },
    })

    if (result.exitCode !== 0) {
      runSpin.stop('Install failed', 1)
      throw new UserFacingError({
        header: `${displayNames[agent]} install failed`,
        body: result.stderr || result.stdout || `Exit code ${result.exitCode}`,
        remediation: 'Inspect the script output above, or run skillnote doctor.',
      })
    }
    runSpin.stop(`${displayNames[agent]} ${c.ok('connected')}`)

    if (agent === 'claude-code') {
      log.info(
        [
          'Next:',
          '  1. Open a new shell (or run `source ~/.zshrc`)',
          '  2. Run `claude`',
          '  3. The skill picker appears',
        ].join('\n'),
      )
    } else if (agent === 'openclaw') {
      log.info('Restart OpenClaw to pick up the SkillNote skill.')
    }

    outro(`${c.ok('Done.')} Run ${c.brand('skillnote status')} to see active agents.`)
  } catch (err) {
    if (err instanceof UserFacingError) {
      process.stderr.write(`\n${prettyError(err.options)}`)
      process.exitCode = 1
      return
    }
    throw err
  }
}

function isSupported(s: string): s is SupportedAgent {
  return (SUPPORTED_AGENTS as readonly string[]).includes(s)
}

export async function pingApi(apiBase: string, timeoutMs = 3_000): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(`${apiBase}/health`, { signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

async function fetchInstallScript(apiBase: string, agent: string): Promise<string> {
  const url = `${apiBase}/setup/agent?agent=${encodeURIComponent(agent)}`
  // 30s ceiling — the install script is small (a few KB) and any honest CDN
  // returns it well under that. Without a timeout a hung upstream stranded
  // the whole `skillnote connect` flow with no recovery short of Ctrl-C.
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 30_000)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    if (!res.ok) {
      throw new UserFacingError({
        header: `Could not fetch install script from ${apiBase}`,
        body: `HTTP ${res.status} ${res.statusText} (${url})`,
        remediation: 'The API may be running an older version; try `skillnote update`.',
      })
    }
    return await res.text()
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new UserFacingError({
        header: `Timed out fetching install script from ${apiBase}`,
        body: `No response within 30s (${url})`,
        remediation: 'Check that the backend is reachable, or run with `--verbose` for details.',
      })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
