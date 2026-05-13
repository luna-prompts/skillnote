// Monkey-patch fs with graceful-fs's EPERM/EBUSY/EACCES retry-with-backoff
// before any other fs call. This is what npm CLI itself does — it inherits
// Windows resilience for fs.rename, fs.unlink, etc. (Anti-virus, Defender,
// and Windows Search Indexer transiently lock files; graceful-fs retries
// with exponential backoff up to ~60s.)
import fs from 'node:fs'
import gracefulFs from 'graceful-fs'
gracefulFs.gracefulify(fs)

import { Command } from 'commander'

// Existing commands (file-push surface — kept intact for Phase 2 replacement).
import { addCommand } from './commands/add.js'
import { checkCommand } from './commands/check.js'
import { doctorCommand } from './commands/doctor.js'
import { listCommand } from './commands/list.js'
import { loginCommand } from './commands/login.js'
import { removeCommand } from './commands/remove.js'
import { updateCommand } from './commands/update.js'

// New lifecycle commands (Phase 1).
import { logsCommand } from './commands/logs.js'
import { openCommand } from './commands/open.js'
import { resetCommand } from './commands/reset.js'
import { restartCommand } from './commands/restart.js'
import { startCommand } from './commands/start.js'
import { statusCommand } from './commands/status.js'
import { stopCommand } from './commands/stop.js'

// Agent-connect commands (Phase 2B).
import { connectCommand } from './commands/connect.js'
import { disconnectCommand } from './commands/disconnect.js'
import { reconnectCommand } from './commands/reconnect.js'

// Bridge (Phase 3).
import { bridgeCommand } from './commands/bridge.js'

import { pkgInfo } from './lib/package-info.js'

const program = new Command()

program
  .name('skillnote')
  .description('Self-hosted skill registry for AI coding agents')
  .version(pkgInfo.version, '-v, --version', 'show version')
  .helpOption('-h, --help', 'show help')

// ─── Lifecycle ────────────────────────────────────────────────────────────

program
  .command('start', { isDefault: true })
  .description('Start the SkillNote stack (web + api + database)')
  .option('--web-port <port>', 'override the web port', parseIntOpt)
  .option('--api-port <port>', 'override the api port', parseIntOpt)
  .option('--no-pull', 'skip pulling images (use what is cached)')
  .option('--no-browser', 'do not open the browser automatically')
  .option('-d, --detach', 'exit after services are healthy (do not stream)')
  .option(
    '-f, --force',
    'override the start lockfile even if a prior process is still alive (use when a previous start hung)',
  )
  .action((opts) => startCommand(opts))

program
  .command('stop')
  .description('Stop SkillNote (preserves data by default)')
  .option('--remove-volumes', 'also remove database volumes (destructive)')
  .action((opts) => stopCommand(opts))

program
  .command('restart')
  .description('Restart SkillNote')
  .option('--web-port <port>', 'override the web port', parseIntOpt)
  .option('--api-port <port>', 'override the api port', parseIntOpt)
  .action((opts) => restartCommand(opts))

program
  .command('status')
  .description('Show service health and connected agents')
  .option('--json', 'emit machine-readable JSON')
  .action((opts) => statusCommand(opts))

program
  .command('logs [service]')
  .description('Tail logs (default: all services)')
  .option('-t, --tail <lines>', 'number of lines to show', parseIntOpt, 100)
  .option('-f, --follow', 'follow log output')
  .action((service, opts) => logsCommand({ service, ...opts }))

program
  .command('open')
  .description('Open the web UI in your browser')
  .option('--app', 'open in chromeless app-mode window (Chrome/Edge)')
  .option('--print', 'print the URL instead of opening')
  .action((opts) => openCommand(opts))

program
  .command('reset')
  .description('Stop containers and remove all data (destructive)')
  .option('--confirm', 'skip the confirmation prompt (required for non-TTY contexts)')
  .action((opts) => resetCommand(opts))

// ─── Agent connect (Phase 2B) ─────────────────────────────────────────────

program
  .command('connect <agent>')
  .description('Connect an agent (claude-code, openclaw) to SkillNote')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action((agent, opts) => connectCommand(agent, opts))

program
  .command('disconnect <agent>')
  .description('Disconnect an agent (claude-code, openclaw)')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action((agent, opts) => disconnectCommand(agent, opts))

program
  .command('reconnect <agent>')
  .description('Disconnect then reconnect an agent (refresh install)')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action((agent, opts) => reconnectCommand(agent, opts))

program
  .command('bridge')
  .description('Run the Web ↔ CLI bridge (executes jobs dispatched from the web UI)')
  .action((opts) => bridgeCommand(opts))

// ─── Skills surface (existing — preserved for backwards compatibility) ─────

program
  .command('login')
  .description('Authenticate with a SkillNote registry')
  .option('--host <url>', 'Registry URL')
  .action(loginCommand)

program.command('list').description('List skills available from the registry').action(listCommand)

program
  .command('add [skill]')
  .description('Install a skill from the registry')
  .option('--agent <name>', 'Target specific agent')
  .option('--all', 'Install all available skills')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(addCommand)

program.command('check').description('Check installed skills for updates').action(checkCommand)

program
  .command('update [skill]')
  .description('Update installed skills to latest version')
  .option('--all', 'Update all installed skills')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(updateCommand)

program.command('remove <skill>').description('Remove an installed skill').action(removeCommand)

program
  .command('doctor')
  .description('Run diagnostics on your SkillNote setup')
  .action(doctorCommand)

// Catch unknown subcommands explicitly. With `isDefault: true` on `start`,
// commander otherwise forwards unknown args to the default as positional.
const known = new Set([
  'start',
  'stop',
  'restart',
  'status',
  'logs',
  'open',
  'connect',
  'disconnect',
  'reconnect',
  'bridge',
  'reset',
  'login',
  'list',
  'add',
  'check',
  'update',
  'remove',
  'doctor',
  'help',
])
const firstArg = process.argv[2]
if (firstArg && !firstArg.startsWith('-') && !known.has(firstArg)) {
  process.stderr.write(`error: unknown command '${firstArg}'\n`)
  process.stderr.write('run `skillnote --help` for a list of commands\n')
  process.exit(1)
}

program.parseAsync().catch(async (err) => {
  // R9 F41: UserFacingError thrown BEFORE any per-command try/catch (e.g. the
  // lock-acquire in `skillnote start`) was reaching here and being printed
  // with only `err.message` — the body + remediation list got dropped. Match
  // it here so the user sees the full actionable message.
  if (err && typeof err === 'object' && err.name === 'UserFacingError') {
    const { prettyError } = await import('./ui/errors.js')
    process.stderr.write(`\n${prettyError(err.options)}`)
    process.exit(1)
  }
  console.error('Unexpected error:', err?.message ?? err)
  process.exit(1)
})

function parseIntOpt(value: string): number {
  const n = Number.parseInt(value, 10)
  if (Number.isNaN(n)) throw new Error(`Invalid number: ${value}`)
  return n
}
