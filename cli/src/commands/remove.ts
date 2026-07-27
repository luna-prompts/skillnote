import fs from 'node:fs'
import { getAdapter } from '../agents/index.js'
import { releaseGlobalInstall } from '../manifest/global-registry.js'
import { loadManifest, saveManifest } from '../manifest/index.js'
import * as ui from '../util/ui.js'

export async function removeCommand(skill: string): Promise<void> {
  const projectDir = process.cwd()
  const manifest = loadManifest(projectDir)

  if (!manifest.skills[skill]) {
    ui.fail(`${skill} is not installed.`)
    process.exit(1)
  }

  const entry = manifest.skills[skill]

  const shared: string[] = []
  for (const agentName of entry.agents) {
    const adapter = getAdapter(agentName, projectDir)
    if (!adapter) continue
    // User-global adapters share one directory across every project, so only
    // the last project to release a skill may delete its files.
    if (adapter.scope === 'user') {
      if (!releaseGlobalInstall(agentName, skill, projectDir)) {
        shared.push(adapter.displayName)
        continue
      }
    }
    const dir = adapter.skillDir(skill)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true })
    }
  }

  delete manifest.skills[skill]
  saveManifest(projectDir, manifest)

  ui.success(`Removed ${ui.bold(skill)} from ${entry.agents.join(', ')}`)
  if (shared.length > 0) {
    ui.info(
      `Files kept for ${shared.join(', ')} — another project still has ${skill} installed.`,
    )
  }
}
