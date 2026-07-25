import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectAgents, getAdapter } from '../agents/index.js'
import { ApiClient, type SkillVersionItem } from '../api/client.js'
import { defaultConfigDir, resolveAuth } from '../config/index.js'
import { loadManifest, saveManifest } from '../manifest/index.js'
import { computeSha256 } from '../util/checksum.js'
import * as ui from '../util/ui.js'
import { extractZipSafe } from '../util/zip.js'

function copyDirSync(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true })
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

export async function updateCommand(
  skill: string | undefined,
  options: { all?: boolean; yes?: boolean },
): Promise<void> {
  const auth = resolveAuth(defaultConfigDir())
  if (!auth) {
    ui.fail(`Not logged in. Run ${ui.bold('skillnote login')} first.`)
    process.exit(1)
  }

  const projectDir = process.cwd()
  const manifest = loadManifest(projectDir)
  const client = new ApiClient(auth.host)

  let slugs: string[]
  if (options.all) {
    slugs = Object.keys(manifest.skills)
  } else if (skill) {
    if (!manifest.skills[skill]) {
      ui.fail(`${skill} is not installed. Run ${ui.bold(`skillnote add ${skill}`)} first.`)
      process.exit(1)
    }
    slugs = [skill]
  } else {
    ui.fail('Specify a skill name or use --all')
    process.exit(1)
  }

  if (slugs.length === 0) {
    ui.info('No skills installed.')
    return
  }

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const slug of slugs) {
    const entry = manifest.skills[slug]
    const spin = ui.spinner(`Checking ${slug}...`)
    spin.start()

    let versions: SkillVersionItem[]
    try {
      versions = await client.listVersions(slug)
    } catch (err: any) {
      spin.stop()
      ui.fail(`${slug}: ${err.message}`)
      failed++
      continue
    }

    // Skills installed from never-published content carry version 'current';
    // they have no published version to compare, so re-fetch the current
    // bundle and diff by checksum instead.
    const latest = versions.find((v) => v.status === 'active')
    const wasCurrent = entry.version === 'current'
    // Versions exist but none is active: the skill was withdrawn, not
    // drafted. Say so instead of reporting it as up to date — and never
    // reach for the current-content fallback, which would defeat the
    // withdrawal (`add` and the server agree on this rule).
    if (!latest && versions.length > 0) {
      spin.stop()
      ui.warn(`${slug}: no active version (all published versions are disabled)`)
      skipped++
      continue
    }
    if ((!latest && !wasCurrent) || (latest && latest.version === entry.version)) {
      spin.stop()
      ui.info(`${slug} is up to date (${entry.version})`)
      skipped++
      continue
    }
    const versionLabel = latest ? latest.version : 'current'

    spin.text = `Downloading ${slug}@${versionLabel}...`
    let buffer: Buffer
    let serverChecksum: string
    try {
      const dl = await client.downloadBundle(slug, versionLabel)
      buffer = dl.buffer
      serverChecksum = dl.checksum
    } catch (err: any) {
      spin.stop()
      ui.fail(`${slug}: download failed — ${err.message}`)
      failed++
      continue
    }

    const localChecksum = computeSha256(buffer)
    if (serverChecksum && localChecksum !== serverChecksum) {
      spin.stop()
      ui.fail(`${slug}: checksum mismatch`)
      failed++
      continue
    }
    if (versionLabel === 'current' && localChecksum === entry.checksum) {
      spin.stop()
      ui.info(`${slug} is up to date (current)`)
      skipped++
      continue
    }

    spin.text = `Extracting ${slug}@${versionLabel}...`
    const tmpDir = path.join(
      os.tmpdir(),
      `skillnote-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    try {
      extractZipSafe(buffer, tmpDir)
    } catch (err: any) {
      spin.stop()
      ui.fail(`${slug}: extraction failed — ${err.message}`)
      failed++
      continue
    }

    const agents = entry.agents
      .map((name) => getAdapter(name, projectDir))
      .filter((a): a is NonNullable<typeof a> => a !== undefined)

    if (agents.length === 0) {
      const detected = detectAgents(projectDir)
      agents.push(...detected)
    }

    for (const agent of agents) {
      // Codex skills used to install into <project>/.codex/skills; they now
      // go to the user-global ~/.agents/skills. Without cleaning the old
      // path, an "updated" skill leaves a stale copy behind that Codex still
      // loads, so the user keeps getting the version they just replaced.
      if (agent.name === 'codex') {
        const legacy = path.join(projectDir, '.codex', 'skills', slug)
        if (legacy !== agent.skillDir(slug) && fs.existsSync(legacy)) {
          fs.rmSync(legacy, { recursive: true, force: true })
        }
      }
      const dest = agent.skillDir(slug)
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true })
      fs.mkdirSync(dest, { recursive: true })
      copyDirSync(tmpDir, dest)
      agent.postInstall?.(slug)
    }

    fs.rmSync(tmpDir, { recursive: true, force: true })

    manifest.skills[slug] = {
      version: versionLabel,
      checksum: localChecksum,
      installedAt: new Date().toISOString(),
      agents: agents.map((a) => a.name),
    }
    saveManifest(projectDir, manifest)

    spin.stop()
    if (versionLabel === 'current') {
      ui.success(`${slug}: current content refreshed`)
    } else {
      ui.success(`${slug}: ${entry.version} → ${versionLabel}`)
    }
    updated++
  }

  if (slugs.length > 1) {
    console.log()
    ui.info(`${updated} updated, ${skipped} up to date, ${failed} failed`)
  }
}
