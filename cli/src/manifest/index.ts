import fs from 'node:fs'
import path from 'node:path'

export interface SkillEntry {
  version: string
  checksum: string
  installedAt: string
  agents: string[]
}

export interface Manifest {
  skills: Record<string, SkillEntry>
}

const MANIFEST_FILE = '.skillnote/manifest.json'

export function loadManifest(projectDir: string): Manifest {
  const filePath = path.join(projectDir, MANIFEST_FILE)
  if (!fs.existsSync(filePath)) {
    return { skills: {} }
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as Manifest
  } catch {
    return { skills: {} }
  }
}

export function saveManifest(projectDir: string, manifest: Manifest): void {
  const dir = path.join(projectDir, '.skillnote')
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, 'manifest.json')
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n')
}
