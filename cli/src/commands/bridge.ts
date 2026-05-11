import { intro, log, outro, spinner } from '@clack/prompts'
import { runBridgeLoop } from '../bridge/poll.js'
import { loadConfig } from '../state/config.js'
import { UserFacingError, prettyError } from '../ui/errors.js'
import { c } from '../ui/theme.js'
import { pingApi } from './connect.js'

export interface BridgeOptions {
  once?: boolean
}

/**
 * Run the Web ↔ CLI bridge loop as a standalone process.
 *
 * Useful when SkillNote was started detached (`skillnote start -d`) and the
 * user wants browser-initiated jobs to be executed locally.
 */
export async function bridgeCommand(_opts: BridgeOptions = {}): Promise<void> {
  try {
    const config = await loadConfig()
    const apiBase = config.host

    intro(c.brandBold('SkillNote bridge'))

    const reach = spinner()
    reach.start(`Connecting to ${c.dim(apiBase)}`)
    const ok = await pingApi(apiBase)
    if (!ok) {
      reach.stop('API unreachable', 1)
      throw new UserFacingError({
        header: 'SkillNote API not reachable',
        body: `Tried: ${apiBase}/health`,
        remediation: 'Run `skillnote start` first, then re-run the bridge.',
      })
    }
    reach.stop(`Connected to ${c.brand(apiBase)}`)

    log.message('Bridge running. Click [Run] in the SkillNote web UI to dispatch a job here.')
    log.message('Press Ctrl+C to exit (the running services keep going).')

    const abort = new AbortController()
    const onSig = () => abort.abort()
    process.on('SIGINT', onSig)
    process.on('SIGTERM', onSig)

    try {
      await runBridgeLoop({
        apiBase,
        signal: abort.signal,
        onLog: (msg) => log.message(c.dim(msg)),
      })
    } finally {
      process.off('SIGINT', onSig)
      process.off('SIGTERM', onSig)
    }

    outro('Bridge stopped.')
  } catch (err) {
    if (err instanceof UserFacingError) {
      process.stderr.write(`\n${prettyError(err.options)}`)
      process.exitCode = 1
      return
    }
    throw err
  }
}
