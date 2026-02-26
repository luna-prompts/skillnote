import { Command } from 'commander'
import { loginCommand } from './commands/login.js'
import { listCommand } from './commands/list.js'
import { addCommand } from './commands/add.js'
import { checkCommand } from './commands/check.js'
import { updateCommand } from './commands/update.js'
import { removeCommand } from './commands/remove.js'
import { doctorCommand } from './commands/doctor.js'

const program = new Command()

program
  .name('skillnote')
  .description('CLI for the SkillNote skills registry')
  .version('0.1.0')

program
  .command('login')
  .description('Authenticate with a SkillNote registry')
  .option('--host <url>', 'Registry URL')
  .option('--token <token>', 'Access token')
  .action(loginCommand)

program
  .command('list')
  .description('List skills available from the registry')
  .action(listCommand)

program
  .command('add [skill]')
  .description('Install a skill from the registry')
  .option('--agent <name>', 'Target specific agent (claude, cursor, codex, openclaw, openhands, universal)')
  .option('--all', 'Install all available skills')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(addCommand)

program
  .command('check')
  .description('Check installed skills for updates')
  .action(checkCommand)

program
  .command('update [skill]')
  .description('Update installed skills to latest version')
  .option('--all', 'Update all installed skills')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(updateCommand)

program
  .command('remove <skill>')
  .description('Remove an installed skill')
  .action(removeCommand)

program
  .command('doctor')
  .description('Run diagnostics on your SkillNote setup')
  .action(doctorCommand)

program.parse()
