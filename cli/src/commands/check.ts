import { ApiClient } from '../api/client.js'
import { defaultConfigDir, resolveAuth } from '../config/index.js'
import { loadManifest } from '../manifest/index.js'
import { computeSha256 } from '../util/checksum.js'
import * as ui from '../util/ui.js'

export async function checkCommand(): Promise<void> {
  const auth = resolveAuth(defaultConfigDir())
  if (!auth) {
    ui.fail(`Not logged in. Run ${ui.bold('skillnote login')} first.`)
    process.exit(1)
  }

  const manifest = loadManifest(process.cwd())
  const slugs = Object.keys(manifest.skills)
  if (slugs.length === 0) {
    ui.info(`No skills installed. Run ${ui.bold('skillnote add <skill>')} to install one.`)
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
      const latest = versions.find((v) => v.status === 'active')
      if (latest && latest.version !== installed.version) {
        rows.push([slug, `${installed.version} → ${latest.version}`, 'update available'])
        updatesAvailable++
      } else if (!latest && versions.length > 0) {
        rows.push([slug, installed.version, 'withdrawn (no active version)'])
      } else if (installed.version === 'current') {
        // Unpublished skills have no version to compare, so drift is only
        // visible by re-fetching the bundle and diffing the checksum —
        // otherwise `check` would always claim they're up to date and the
        // advertised check-then-update flow would never flag them.
        try {
          const dl = await client.downloadBundle(slug, 'current')
          const changed = computeSha256(dl.buffer) !== installed.checksum
          rows.push([slug, 'current', changed ? 'content changed' : 'up to date'])
          if (changed) updatesAvailable++
        } catch {
          rows.push([slug, 'current', 'error checking'])
        }
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
    ui.info(
      `${updatesAvailable} update(s) available. Run ${ui.bold('skillnote update --all')} to update.`,
    )
  }
}
