import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { confirm, intro, log, outro, spinner } from '@clack/prompts'
import { isInteractive } from '../lib/system.js'
import { UserFacingError, prettyError } from '../ui/errors.js'
import { c } from '../ui/theme.js'
import { SUPPORTED_AGENTS, type SupportedAgent } from './connect.js'

export interface DisconnectOptions {
  yes?: boolean
}

export async function disconnectCommand(
  agent: string,
  opts: DisconnectOptions = {},
): Promise<void> {
  try {
    if (!isSupported(agent)) {
      throw new UserFacingError({
        header: `Unknown agent: '${agent}'`,
        body: 'Supported agents:',
        remediation: SUPPORTED_AGENTS.map((a) => `  ${a}`),
      })
    }

    intro(c.brandBold(`Disconnecting ${agent}`))

    if (agent === 'openclaw') {
      await disconnectOpenClaw(opts)
    } else if (agent === 'claude-code') {
      await disconnectClaudeCode(opts)
    }

    outro(`${c.ok('Done.')} Run ${c.brand('skillnote status')} to confirm.`)
  } catch (err) {
    if (err instanceof UserFacingError) {
      process.stderr.write(`\n${prettyError(err.options)}`)
      process.exitCode = 1
      return
    }
    throw err
  }
}

async function disconnectOpenClaw(opts: DisconnectOptions): Promise<void> {
  const skillDir = join(homedir(), '.openclaw', 'skills', 'skillnote')
  const proceed = await confirmIfNeeded(opts.yes, `Remove ${skillDir}?`)
  if (!proceed) {
    log.info('Aborted. Nothing changed.')
    return
  }
  const s = spinner()
  s.start('Removing OpenClaw skill bundle')
  await rm(skillDir, { recursive: true, force: true })
  s.stop(`Removed ${c.dim(skillDir)}`)
  log.info('Also stop the log-watcher if it is running: pkill -f "log-watcher.py"')
}

async function disconnectClaudeCode(_opts: DisconnectOptions): Promise<void> {
  // Claude Code's install is multi-step (plugin marketplace, binaries, shell
  // wrapper). Reverting it programmatically is risky — surfacing manual
  // instructions is safer until we have proper rollback metadata.
  log.warn('Disconnecting Claude Code is currently a guided manual process.')
  log.info(
    [
      'To fully disconnect Claude Code:',
      '  1. Edit ~/.claude/settings.json and remove the entry under',
      '     "extraKnownMarketplaces" pointing to skillnote-local.',
      '  2. Run: rm -rf ~/.claude/plugins/marketplaces/skillnote-local',
      '  3. Run: rm -rf ~/.skillnote/bin',
      '  4. Edit your shell rc file (~/.zshrc or ~/.bashrc) and delete the',
      '     block between the markers:',
      '       # >>> SKILLNOTE WRAPPER BEGIN',
      '       # <<< SKILLNOTE WRAPPER END',
      '  5. Open a new shell so the changes take effect.',
    ].join('\n'),
  )
}

async function confirmIfNeeded(yes: boolean | undefined, message: string): Promise<boolean> {
  if (yes || !isInteractive()) return true
  const result = await confirm({ message, initialValue: false })
  // @clack/prompts returns true/false or a Symbol on cancel.
  return result === true
}

function isSupported(s: string): s is SupportedAgent {
  return (SUPPORTED_AGENTS as readonly string[]).includes(s)
}
