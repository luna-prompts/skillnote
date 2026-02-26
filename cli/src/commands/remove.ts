import fs from 'node:fs'
import { loadManifest, saveManifest } from '../manifest/index.js'
import { getAdapter } from '../agents/index.js'
import * as ui from '../util/ui.js'

export async function removeCommand(skill: string): Promise<void> {
  const projectDir = process.cwd()
  const manifest = loadManifest(projectDir)

  if (!manifest.skills[skill]) {
    ui.fail(`${skill} is not installed.`)
    process.exit(1)
  }

  const entry = manifest.skills[skill]

  for (const agentName of entry.agents) {
    const adapter = getAdapter(agentName, projectDir)
    if (!adapter) continue
    const dir = adapter.skillDir(skill)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true })
    }
  }

  delete manifest.skills[skill]
  saveManifest(projectDir, manifest)

  ui.success(`Removed ${ui.bold(skill)} from ${entry.agents.join(', ')}`)
}
