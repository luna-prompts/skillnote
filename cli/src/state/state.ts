import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'
import { getPaths } from '../lib/system.js'

// write-file-atomic (90M weekly DLs, used by the npm CLI itself) handles:
//   - tmp + rename + fsync on every platform
//   - in-process serialization queue per-path (concurrent saves don't race)
//   - graceful-fs retry on Windows EPERM/EBUSY from AV / Search Indexer
async function atomicWrite(path: string, content: string, mode: number): Promise<void> {
  await writeFileAtomic(path, content, { mode, fsync: true })
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
