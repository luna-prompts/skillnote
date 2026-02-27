import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface Config {
  host: string
}

export function defaultConfigDir(): string {
  return path.join(os.homedir(), '.skillnote')
}

export function loadConfig(configDir: string): Config | null {
  const filePath = path.join(configDir, 'config.json')
  if (!fs.existsSync(filePath)) return null
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    if (typeof data.host === 'string') {
      return { host: data.host }
    }
    return null
  } catch {
    return null
  }
}

export function saveConfig(configDir: string, config: Config): void {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 })
  const filePath = path.join(configDir, 'config.json')
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
}

export function resolveAuth(configDir: string): Config | null {
  const envHost = process.env.SKILLNOTE_HOST
  if (envHost) {
    return { host: envHost }
  }
  return loadConfig(configDir)
}
