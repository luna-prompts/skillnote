import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectAgents, getAdapter } from '../agents/index.js'
import { ApiClient, type SkillVersionItem } from '../api/client.js'
import { defaultConfigDir, resolveAuth } from '../config/index.js'
import { recordGlobalInstall } from '../manifest/global-registry.js'
import { loadManifest, saveManifest } from '../manifest/index.js'
import { computeSha256 } from '../util/checksum.js'
import * as ui from '../util/ui.js'
import { extractZipSafe } from '../util/zip.js'

function pickLatestActive(versions: SkillVersionItem[]): SkillVersionItem | null {
  return versions.find((v) => v.status === 'active') ?? null
}

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

async function installSkill(
  client: ApiClient,
  slug: string,
  agents: ReturnType<typeof detectAgents>,
  projectDir: string,
): Promise<boolean> {
  const spin = ui.spinner(`Fetching versions for ${ui.bold(slug)}...`)
  spin.start()

  let versions: SkillVersionItem[]
  try {
    versions = await client.listVersions(slug)
  } catch (err: any) {
    spin.stop()
    ui.fail(`${slug}: ${err.message}`)
    return false
  }

  // UI-authored or imported skills may have no published SkillVersion yet;
  // the registry bundles their current content on the fly via
  // /v1/skills/{slug}/current/download. Only *unpublished* skills qualify:
  // a skill whose versions exist but are all disabled has been deliberately
  // withdrawn, and falling back to its draft would route around the only
  // kill switch operators have. (The server enforces this too.)
  const latest = pickLatestActive(versions)
  if (!latest && versions.length > 0) {
    spin.stop()
    ui.fail(`${slug}: no active version (all published versions are disabled)`)
    return false
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
    return false
  }

  spin.text = 'Verifying checksum...'
  const localChecksum = computeSha256(buffer)
  if (serverChecksum && localChecksum !== serverChecksum) {
    spin.stop()
    ui.fail(`${slug}: checksum mismatch`)
    console.log(`  Expected: ${serverChecksum}`)
    console.log(`  Got:      ${localChecksum}`)
    return false
  }

  spin.text = 'Extracting...'
  const tmpDir = path.join(
    os.tmpdir(),
    `skillnote-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  try {
    extractZipSafe(buffer, tmpDir)
  } catch (err: any) {
    spin.stop()
    ui.fail(`${slug}: extraction failed — ${err.message}`)
    return false
  }

  const agentNames: string[] = []
  for (const agent of agents) {
    const dest = agent.skillDir(slug)
    fs.mkdirSync(dest, { recursive: true })
    copyDirSync(tmpDir, dest)
    agent.postInstall?.(slug)
    // Claim a share of the user-global directory so a later `remove` in
    // another project can't delete files this one still depends on.
    if (agent.scope === 'user') recordGlobalInstall(agent.name, slug, projectDir)
    agentNames.push(agent.name)
  }

  fs.rmSync(tmpDir, { recursive: true, force: true })

  const manifest = loadManifest(projectDir)
  manifest.skills[slug] = {
    version: versionLabel,
    checksum: localChecksum,
    installedAt: new Date().toISOString(),
    agents: agentNames,
  }
  saveManifest(projectDir, manifest)

  spin.stop()
  ui.success(`${ui.bold(slug)}@${versionLabel} installed to ${agentNames.join(', ')}`)
  return true
}

export async function addCommand(
  skill: string | undefined,
  options: { agent?: string; all?: boolean; yes?: boolean },
): Promise<void> {
  const auth = resolveAuth(defaultConfigDir())
  if (!auth) {
    ui.fail(`Not logged in. Run ${ui.bold('skillnote login')} first.`)
    process.exit(1)
  }

  const projectDir = process.cwd()
  const client = new ApiClient(auth.host)

  let agents = options.agent
    ? ([getAdapter(options.agent, projectDir)].filter(Boolean) as ReturnType<typeof detectAgents>)
    : detectAgents(projectDir)

  if (agents.length === 0) {
    ui.warn('No agents detected. Using Universal adapter (.agents/skills/)')
    const { UniversalAdapter } = await import('../agents/universal.js')
    agents = [new UniversalAdapter(projectDir)]
  }

  ui.info(`Target agents: ${agents.map((a) => a.displayName).join(', ')}`)

  let slugs: string[]
  if (options.all) {
    const spin = ui.spinner('Fetching skill list...')
    spin.start()
    const skills = await client.listSkills()
    spin.stop()
    slugs = skills.map((s) => s.slug)
  } else if (skill) {
    slugs = [skill]
  } else {
    ui.fail('Specify a skill name or use --all')
    process.exit(1)
  }

  let succeeded = 0
  let failed = 0
  for (const slug of slugs) {
    const ok = await installSkill(client, slug, agents, projectDir)
    if (ok) succeeded++
    else failed++
  }

  if (slugs.length > 1) {
    console.log()
    ui.info(`${succeeded} installed, ${failed} failed`)
  }
}
