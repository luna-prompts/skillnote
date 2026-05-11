import { confirm, intro, log, outro, spinner } from '@clack/prompts'
import { type ComposeOptions, composeDown, ensureComposeExtracted } from '../docker/compose.js'
import { requireDocker } from '../docker/inspect.js'
import { pkgInfo } from '../lib/package-info.js'
import { isInteractive } from '../lib/system.js'
import { UserFacingError, prettyError } from '../ui/errors.js'
import { c } from '../ui/theme.js'

export interface ResetOptions {
  confirm?: boolean
}

/**
 * Destructive: stop containers and remove the Postgres + bundle volumes.
 * Equivalent to `docker compose down -v`. Requires explicit confirmation
 * because all skills, ratings, comments, and uploads are lost.
 */
export async function resetCommand(opts: ResetOptions = {}): Promise<void> {
  try {
    intro(c.brandBold('Reset SkillNote (destructive)'))

    if (!opts.confirm && !isInteractive()) {
      throw new UserFacingError({
        header: 'Reset requires explicit confirmation in non-interactive contexts',
        body: 'This will delete all skills, ratings, and uploaded bundles.',
        remediation: 'Run again with --confirm to proceed without a prompt.',
      })
    }

    if (!opts.confirm) {
      log.warn(
        [
          'This will permanently delete:',
          `  ${c.muted('•')} every skill in your local registry`,
          `  ${c.muted('•')} all ratings, comments, usage analytics`,
          `  ${c.muted('•')} the Postgres volume (pgdata)`,
          `  ${c.muted('•')} the bundles volume (uploaded zips)`,
          '',
          'There is no undo.',
        ].join('\n'),
      )
      const proceed = await confirm({
        message: 'Type yes to reset',
        initialValue: false,
      })
      if (proceed !== true) {
        log.info('Aborted. Nothing changed.')
        outro('Cancelled.')
        return
      }
    }

    await requireDocker()
    const composeFile = await ensureComposeExtracted(pkgInfo.version)
    const composeOpts: ComposeOptions = { composeFile }

    const s = spinner()
    s.start('Removing containers and volumes')
    await composeDown(composeOpts, /* removeVolumes */ true)
    s.stop(`Removed ${c.warn('everything')}`)

    outro(`${c.ok('Reset complete.')} Run ${c.brand('skillnote start')} to seed a fresh install.`)
  } catch (err) {
    if (err instanceof UserFacingError) {
      process.stderr.write(`\n${prettyError(err.options)}`)
      process.exitCode = 1
      return
    }
    throw err
  }
}
