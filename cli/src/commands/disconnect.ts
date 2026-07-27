import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { confirm, intro, log, outro, spinner } from '@clack/prompts'
import { execa } from 'execa'
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
    } else if (agent === 'codex') {
      await disconnectCodex(opts)
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

async function disconnectCodex(opts: DisconnectOptions): Promise<void> {
  const proceed = await confirmIfNeeded(
    opts.yes,
    'Remove the SkillNote Codex plugin, marketplace, and shell wrapper?',
  )
  if (!proceed) {
    log.info('Aborted. Nothing changed.')
    return
  }

  const s = spinner()
  s.start('Disconnecting Codex')
  // Let codex itself unregister the plugin and marketplace — it owns
  // config.toml and hand-editing it risks a broken TOML.
  const unregistered = await runCodex([
    ['plugin', 'remove', 'skillnote@skillnote-local'],
    ['plugin', 'marketplace', 'remove', 'skillnote-local'],
  ])

  const wrapperRemoved = await removeCodexWrapper()

  // Only destroy the marketplace directory once codex has stopped pointing
  // at it. Deleting it while config.toml still references the plugin leaves
  // codex loading hooks from its own cache — a "disconnect" that disconnects
  // nothing, plus a marketplace entry aimed at a path that no longer exists.
  if (unregistered) {
    await rm(join(homedir(), '.skillnote', 'codex'), { recursive: true, force: true })
  }
  s.stop(
    unregistered
      ? 'Removed the Codex plugin, marketplace, and shell wrapper'
      : 'Removed the shell wrapper',
  )

  if (!unregistered) {
    log.warn('Could not run `codex` to unregister the plugin.')
    log.info(
      [
        'The plugin is still installed and its hooks will keep syncing.',
        'Finish the disconnect once Codex is on your PATH:',
        '  codex plugin remove skillnote@skillnote-local',
        '  codex plugin marketplace remove skillnote-local',
        '  rm -rf ~/.skillnote/codex',
      ].join('\n'),
    )
  }
  if (!wrapperRemoved) {
    log.warn(
      'Could not edit your shell rc file; remove the block between the ' +
        '"# >>> SKILLNOTE CODEX WRAPPER BEGIN/END" markers by hand.',
    )
  }
  log.info(
    [
      'Left in place:',
      '  - Synced skills under per-project .codex/skills/skillnote-*/ dirs',
      '  - ~/.skillnote/bin/skillnote-pick and ~/.skillnote/host (shared with Claude Code)',
      'Open a new shell so the wrapper removal takes effect.',
    ].join('\n'),
  )
}

/**
 * Run a sequence of `codex` subcommands, reporting whether the CLI was
 * actually usable. A missing binary resolves (execa's `reject: false`) rather
 * than throwing, so the exit code is the only honest signal. "Already
 * removed" is success: codex exits non-zero, but there is nothing left to do.
 */
async function runCodex(argSets: string[][]): Promise<boolean> {
  let sawBinary = false
  for (const args of argSets) {
    try {
      const result = await execa('codex', args, { reject: false })
      // ENOENT surfaces as a failed result with no exit code.
      if (typeof result.exitCode === 'number') sawBinary = true
    } catch {
      // Spawn failure (missing binary, permission denied) — nothing ran.
    }
  }
  return sawBinary
}

async function removeCodexWrapper(): Promise<boolean> {
  const home = homedir()
  const rcFiles = [
    join(home, '.zshrc'),
    join(home, '.bashrc'),
    join(home, '.bash_profile'),
    join(home, '.profile'),
    join(home, '.config', 'fish', 'config.fish'),
  ]
  let ok = true
  for (const rc of rcFiles) {
    try {
      const content = await readFile(rc, 'utf8')
      // Collapse only the blank lines the removal itself leaves behind. A
      // global /\n{3,}/ squeeze would silently reformat unrelated parts of
      // the user's shell config.
      const cleaned = content.replace(
        /\n*# >>> SKILLNOTE CODEX WRAPPER BEGIN[\s\S]*?# <<< SKILLNOTE CODEX WRAPPER END\n*/g,
        '\n\n',
      )
      if (cleaned === content) continue
      // Write via a temp file + rename: a truncating write that dies midway
      // would leave the user without a shell config.
      const tmp = `${rc}.skillnote-tmp`
      await writeFile(tmp, cleaned, 'utf8')
      await rename(tmp, rc)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        ok = false
        log.warn(`Could not clean the SkillNote wrapper from ${rc}.`)
      }
    }
  }
  return ok
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
