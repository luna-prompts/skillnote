import { ApiClient } from '../api/client.js'
import { defaultConfigDir, resolveAuth } from '../config/index.js'
import { loadManifest } from '../manifest/index.js'
import * as ui from '../util/ui.js'

export async function listCommand(): Promise<void> {
  const auth = resolveAuth(defaultConfigDir())
  if (!auth) {
    ui.fail('Not logged in. Run ' + ui.bold('skillnote login') + ' first.')
    process.exit(1)
  }

  const spin = ui.spinner('Fetching skills...')
  spin.start()

  const client = new ApiClient(auth.host)
  const skills = await client.listSkills()
  spin.stop()

  if (skills.length === 0) {
    ui.info('No skills available.')
    return
  }

  const manifest = loadManifest(process.cwd())
  const rows = skills.map(s => {
    const installed = manifest.skills[s.slug]
    let status = 'available'
    if (installed) {
      status = installed.version === s.latestVersion ? 'installed' : 'outdated'
    }
    return [
      s.slug,
      s.latestVersion ?? '-',
      status,
      (s.tags ?? []).join(', ') || '-',
    ]
  })

  ui.table(['NAME', 'VERSION', 'STATUS', 'TAGS'], rows)
}
