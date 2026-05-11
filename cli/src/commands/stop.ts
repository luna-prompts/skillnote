import { intro, outro, spinner } from '@clack/prompts'
import { type ComposeOptions, composeDown, ensureComposeExtracted } from '../docker/compose.js'
import { requireDocker } from '../docker/inspect.js'
import { pkgInfo } from '../lib/package-info.js'
import { UserFacingError, prettyError } from '../ui/errors.js'
import { c } from '../ui/theme.js'

export interface StopOptions {
  removeVolumes?: boolean
}

export async function stopCommand(opts: StopOptions = {}): Promise<void> {
  try {
    intro(c.brandBold('Stopping SkillNote'))
    await requireDocker()
    const composeFile = await ensureComposeExtracted(pkgInfo.version)
    const composeOpts: ComposeOptions = { composeFile }

    const stopSpin = spinner()
    stopSpin.start(opts.removeVolumes ? 'Removing containers and volumes' : 'Stopping containers')
    await composeDown(composeOpts, opts.removeVolumes)
    stopSpin.stop(`Stopped ${c.ok('ok')}`)

    if (opts.removeVolumes) {
      outro(`${c.ok('SkillNote stopped.')} Data volumes ${c.warn('removed')}.`)
    } else {
      outro(
        `${c.ok('SkillNote stopped.')} Data preserved. Run ${c.brand('skillnote start')} to resume.`,
      )
    }
  } catch (err) {
    if (err instanceof UserFacingError) {
      process.stderr.write(`\n${prettyError(err.options)}`)
      process.exitCode = 1
      return
    }
    throw err
  }
}
