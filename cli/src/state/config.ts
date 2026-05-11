import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { getPaths } from '../lib/system.js'

// Same atomic-write pattern as state.ts — see comment there for rationale.
// Per-call counter prevents collisions when multiple concurrent saves are
// in flight within the same process.
let _atomicCounter = 0
async function atomicWrite(path: string, content: string, mode: number): Promise<void> {
  const seq = ++_atomicCounter
  const tmp = `${path}.${process.pid}.${seq}.tmp`
  await writeFile(tmp, content, { mode })
  try {
    await rename(tmp, path)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
}

export const ConfigSchema = z.object({
  host: z.string().url().default('http://localhost:8082'),
  webPort: z.number().int().min(1).max(65535).default(3000),
  apiPort: z.number().int().min(1).max(65535).default(8082),
  browserMode: z.enum(['default', 'app', 'none']).default('default'),
  updateCheck: z.boolean().default(true),
  telemetry: z.boolean().default(false),
})

export type Config = z.infer<typeof ConfigSchema>

export const defaultConfig: Config = ConfigSchema.parse({})

export async function loadConfig(path: string = getPaths().configFile): Promise<Config> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    return ConfigSchema.parse(parsed)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...defaultConfig }
    }
    if (err instanceof z.ZodError) {
      // Surface schema issues rather than silently resetting.
      throw new Error(
        `Config file at ${path} is invalid: ${err.issues.map((i) => i.message).join(', ')}`,
      )
    }
    throw err
  }
}

export async function saveConfig(
  config: Config,
  path: string = getPaths().configFile,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  // Validate before write — catches drift between code and schema.
  const validated = ConfigSchema.parse(config)
  await atomicWrite(path, `${JSON.stringify(validated, null, 2)}\n`, 0o600)
}

export async function updateConfig(
  patch: Partial<Config>,
  path: string = getPaths().configFile,
): Promise<Config> {
  const current = await loadConfig(path)
  const next = { ...current, ...patch }
  await saveConfig(next, path)
  return next
}
