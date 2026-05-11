import { getLatestVersion } from 'fast-npm-meta'

/**
 * Best-effort check for a newer version of the package on npm.
 * Returns null on any network or registry error — never throws.
 */
export async function checkForUpdate(
  packageName: string,
  currentVersion: string,
  timeoutMs = 3_000,
): Promise<string | null> {
  try {
    const result = await withTimeout(getLatestVersion(packageName), timeoutMs)
    const latest = typeof result === 'string' ? result : result?.version
    if (!latest || latest === currentVersion) return null
    return isNewer(latest, currentVersion) ? latest : null
  } catch {
    return null
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

// Naive semver comparison sufficient for our needs (major.minor.patch[-pre]).
export function isNewer(a: string, b: string): boolean {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    const av = pa.numbers[i] ?? 0
    const bv = pb.numbers[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }
  // Equal numerics: a stable release ("") beats any prerelease ("-alpha.x").
  if (!pa.prerelease && pb.prerelease) return true
  if (pa.prerelease && !pb.prerelease) return false
  return pa.prerelease > pb.prerelease
}

function parseVersion(v: string): { numbers: number[]; prerelease: string } {
  const [base, prerelease = ''] = v.split('-')
  const numbers = (base ?? '').split('.').map((s) => Number.parseInt(s, 10) || 0)
  return { numbers, prerelease }
}
