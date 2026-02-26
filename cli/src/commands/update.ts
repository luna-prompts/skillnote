import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ApiClient, type SkillVersionItem } from '../api/client.js'
import { defaultConfigDir, resolveAuth } from '../config/index.js'
import { loadManifest, saveManifest } from '../manifest/index.js'
import { getAdapter, detectAgents } from '../agents/index.js'
import { computeSha256 } from '../util/checksum.js'
import { extractZipSafe } from '../util/zip.js'
import * as ui from '../util/ui.js'

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
    ui.fail('Not logged in. Run ' + ui.bold('skillnote login') + ' first.')
    process.exit(1)
  }

  const projectDir = process.cwd()
  const manifest = loadManifest(projectDir)
  const client = new ApiClient(auth.host, auth.token)

  let slugs: string[]
  if (options.all) {
    slugs = Object.keys(manifest.skills)
  } else if (skill) {
    if (!manifest.skills[skill]) {
      ui.fail(`${skill} is not installed. Run ${ui.bold('skillnote add ' + skill)} first.`)
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

    const latest = versions.find(v => v.status === 'active')
    if (!latest || latest.version === entry.version) {
      spin.stop()
      ui.info(`${slug} is up to date (${entry.version})`)
      skipped++
      continue
    }

    spin.text = `Downloading ${slug}@${latest.version}...`
    let buffer: Buffer
    let serverChecksum: string
    try {
      const dl = await client.downloadBundle(slug, latest.version)
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

    spin.text = `Extracting ${slug}@${latest.version}...`
    const tmpDir = path.join(os.tmpdir(), `skillnote-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    try {
      extractZipSafe(buffer, tmpDir)
    } catch (err: any) {
      spin.stop()
      ui.fail(`${slug}: extraction failed — ${err.message}`)
      failed++
      continue
    }

    const agents = entry.agents
      .map(name => getAdapter(name, projectDir))
      .filter((a): a is NonNullable<typeof a> => a !== undefined)

    if (agents.length === 0) {
      const detected = detectAgents(projectDir)
      agents.push(...detected)
    }

    for (const agent of agents) {
      const dest = agent.skillDir(slug)
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true })
      fs.mkdirSync(dest, { recursive: true })
      copyDirSync(tmpDir, dest)
      agent.postInstall?.(slug)
    }

    fs.rmSync(tmpDir, { recursive: true, force: true })

    manifest.skills[slug] = {
      version: latest.version,
      checksum: localChecksum,
      installedAt: new Date().toISOString(),
      agents: agents.map(a => a.name),
    }
    saveManifest(projectDir, manifest)

    spin.stop()
    ui.success(`${slug}: ${entry.version} → ${latest.version}`)
    updated++
  }

  if (slugs.length > 1) {
    console.log()
    ui.info(`${updated} updated, ${skipped} up to date, ${failed} failed`)
  }
}
