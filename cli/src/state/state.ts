import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { getPaths } from '../lib/system.js'

// Write-then-rename for atomicity: a crash mid-write leaves the .tmp file
// behind but the live file is never half-written. POSIX rename() is atomic
// within the same filesystem; we always write the temp next to the target.
// The temp filename includes PID + a per-call counter so concurrent writes
// in the same process don't collide on the same temp path.
let _atomicCounter = 0
async function atomicWrite(path: string, content: string, mode: number): Promise<void> {
  const seq = ++_atomicCounter
  const tmp = `${path}.${process.pid}.${seq}.tmp`
  await writeFile(tmp, content, { mode })
  try {
    await rename(tmp, path)
  } catch (err) {
    // Best-effort cleanup; the rename failure is what we surface to the caller.
    await unlink(tmp).catch(() => undefined)
    throw err
  }
}

// Internal state — what the CLI remembers between runs but the user doesn't
// directly edit. Distinct from `config.json` which is user-facing.
export const StateSchema = z.object({
  version: z.string().default('0.5.0-alpha.0'),
  seenWelcome: z.boolean().default(false),
  firstStart: z.string().optional(),
  lastStart: z.string().optional(),
  lastUpdateCheck: z.string().optional(),
  pendingUpdate: z.string().optional(),
  cliSessionToken: z.string().optional(),
  totalStarts: z.number().int().default(0),
})

export type State = z.infer<typeof StateSchema>

export const defaultState: State = StateSchema.parse({})

export async function loadState(path: string = getPaths().stateFile): Promise<State> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    // Be lenient with state — unknown fields don't fail; we re-parse with defaults.
    return StateSchema.parse(parsed)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...defaultState }
    }
    // For any other error (malformed JSON, schema mismatch), reset rather than crash —
    // state is recoverable; we'd rather not block the user with a broken state file.
    return { ...defaultState }
  }
}

export async function saveState(state: State, path: string = getPaths().stateFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await atomicWrite(path, `${JSON.stringify(state, null, 2)}\n`, 0o600)
}

export async function updateState(
  patch: Partial<State>,
  path: string = getPaths().stateFile,
): Promise<State> {
  const current = await loadState(path)
  const next = StateSchema.parse({ ...current, ...patch })
  await saveState(next, path)
  return next
}

export function newSessionToken(): string {
  // 32 random hex chars — enough entropy for a local-only auth token.
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
