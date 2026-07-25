import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Reference counting for skills installed into a user-global directory.
 *
 * Adapters with `scope: 'user'` (Codex) write every project's skills into one
 * shared directory, while install bookkeeping lives in per-project manifests.
 * Without a machine-level ledger, `skillnote remove foo` in project A deletes
 * the files project B's manifest still claims are installed — B's skill
 * vanishes with no warning and its `doctor` reports it missing.
 *
 * The ledger maps "<agent>:<slug>" to the set of project directories that
 * asked for it. Files are only deleted when the last project releases them.
 */

interface GlobalRegistry {
  installs: Record<string, string[]>
}

function registryPath(homeDir = os.homedir()): string {
  return path.join(homeDir, '.skillnote', 'global-installs.json')
}

function load(homeDir?: string): GlobalRegistry {
  try {
    const raw = fs.readFileSync(registryPath(homeDir), 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && parsed.installs && typeof parsed.installs === 'object') {
      return parsed as GlobalRegistry
    }
  } catch {
    // Missing or corrupt ledger: start clean rather than blocking the command.
  }
  return { installs: {} }
}

function save(registry: GlobalRegistry, homeDir?: string): void {
  const file = registryPath(homeDir)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tmp, file)
}

function key(agent: string, slug: string): string {
  return `${agent}:${slug}`
}

/** Record that `projectDir` depends on a globally-installed skill. */
export function recordGlobalInstall(
  agent: string,
  slug: string,
  projectDir: string,
  homeDir?: string,
): void {
  const registry = load(homeDir)
  const k = key(agent, slug)
  const holders = new Set(registry.installs[k] ?? [])
  holders.add(projectDir)
  registry.installs[k] = [...holders].sort()
  save(registry, homeDir)
}

/**
 * Release this project's claim. Returns true when no other project still
 * depends on the skill, i.e. the caller may delete the shared files.
 */
export function releaseGlobalInstall(
  agent: string,
  slug: string,
  projectDir: string,
  homeDir?: string,
): boolean {
  const registry = load(homeDir)
  const k = key(agent, slug)
  const holders = (registry.installs[k] ?? []).filter((p) => p !== projectDir)
  if (holders.length > 0) {
    registry.installs[k] = holders
    save(registry, homeDir)
    return false
  }
  delete registry.installs[k]
  save(registry, homeDir)
  return true
}

/** Projects other than `projectDir` that still depend on the skill. */
export function otherHolders(
  agent: string,
  slug: string,
  projectDir: string,
  homeDir?: string,
): string[] {
  return (load(homeDir).installs[key(agent, slug)] ?? []).filter((p) => p !== projectDir)
}
