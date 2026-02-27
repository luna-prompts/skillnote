import { ApiClient } from '../api/client.js'
import { defaultConfigDir, resolveAuth } from '../config/index.js'
import { loadManifest } from '../manifest/index.js'
import * as ui from '../util/ui.js'

export async function checkCommand(): Promise<void> {
  const auth = resolveAuth(defaultConfigDir())
  if (!auth) {
    ui.fail('Not logged in. Run ' + ui.bold('skillnote login') + ' first.')
    process.exit(1)
  }

  const manifest = loadManifest(process.cwd())
  const slugs = Object.keys(manifest.skills)
  if (slugs.length === 0) {
    ui.info('No skills installed. Run ' + ui.bold('skillnote add <skill>') + ' to install one.')
    return
  }

  const client = new ApiClient(auth.host)
  const spin = ui.spinner('Checking for updates...')
  spin.start()

  const rows: string[][] = []
  let updatesAvailable = 0

  for (const slug of slugs) {
    const installed = manifest.skills[slug]
    try {
      const versions = await client.listVersions(slug)
      const latest = versions.find(v => v.status === 'active')
      if (latest && latest.version !== installed.version) {
        rows.push([slug, `${installed.version} → ${latest.version}`, 'update available'])
        updatesAvailable++
      } else {
        rows.push([slug, installed.version, 'up to date'])
      }
    } catch {
      rows.push([slug, installed.version, 'error checking'])
    }
  }

  spin.stop()
  ui.table(['NAME', 'VERSION', 'STATUS'], rows)

  if (updatesAvailable > 0) {
    console.log()
    ui.info(`${updatesAvailable} update(s) available. Run ${ui.bold('skillnote update --all')} to update.`)
  }
}
