import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ExecaError, execa } from 'execa'
import { getPaths } from '../lib/system.js'
import { UserFacingError } from '../ui/errors.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Resolve the location of the bundled docker-compose.yml inside the package.
// After tsup bundling, all sources are in dist/index.js, so __dirname is `dist/`.
// Built assets live at dist/assets/docker-compose.yml.
async function findBundledCompose(version: string): Promise<string> {
  // Try every reasonable layout — supports normal npm install, npx, monorepo
  // dev (running tsx/ts-node from src/), and tests that mount fixtures.
  const candidates = [
    // Bundled production: cli/dist/assets/docker-compose.yml
    join(__dirname, 'assets', 'docker-compose.yml'),
    // Compiled-but-relative-to-cmd-dir: cli/dist/docker/../assets/...
    join(__dirname, '..', 'assets', 'docker-compose.yml'),
  ]
  for (const p of candidates) {
    try {
      await stat(p)
      return p
    } catch {
      // try next
    }
  }

  // Dev fallback: locate the source template and substitute on the fly.
  const devTemplateCandidates = [
    join(__dirname, '..', 'assets', 'docker-compose.yml.tpl'),
    join(__dirname, '..', '..', 'assets', 'docker-compose.yml.tpl'),
  ]
  for (const tpl of devTemplateCandidates) {
    try {
      const raw = await readFile(tpl, 'utf8')
      const tmp = join(getPaths().composeDir, 'docker-compose.dev.yml')
      await mkdir(dirname(tmp), { recursive: true })
      await writeFile(tmp, raw.replaceAll('__VERSION__', version))
      return tmp
    } catch {
      // try next
    }
  }

  throw new UserFacingError({
    header: 'Bundled compose file not found',
    body: [
      'Looked for the compose file in expected dist/ and dev-template locations:',
      ...candidates.map((p) => `  ${p}`),
      ...devTemplateCandidates.map((p) => `  ${p}`),
    ],
    remediation: 'If running from source, run `npm run build` in cli/ first.',
  })
}

/**
 * Materialize the bundled compose file into ~/.skillnote/compose/.
 * Re-extracts if missing or version-mismatched.
 * Returns the path to the user-side compose file.
 */
export async function ensureComposeExtracted(version: string): Promise<string> {
  const paths = getPaths()
  await mkdir(paths.composeDir, { recursive: true })

  const target = paths.composeFile
  const stamp = join(paths.composeDir, '.version')

  let currentVersion: string | null = null
  try {
    currentVersion = (await readFile(stamp, 'utf8')).trim()
  } catch {
    // first install
  }

  if (currentVersion !== version) {
    const src = await findBundledCompose(version)
    await copyFile(src, target)
    await writeFile(stamp, version)
  }
  return target
}

export interface ComposeOptions {
  composeFile: string
  projectName?: string
  env?: Record<string, string>
}

function composeArgs(opts: ComposeOptions): string[] {
  return ['compose', '--project-name', opts.projectName ?? 'skillnote', '-f', opts.composeFile]
}

// Maps execa failures to a UserFacingError with the right remediation.
function classify(err: ExecaError): never {
  const msg = (err.stderr || err.stdout || err.message).toString()
  if (
    msg.includes('Cannot connect to the Docker daemon') ||
    msg.includes('connect: connection refused') ||
    msg.includes('docker.sock')
  ) {
    throw new UserFacingError({
      header: 'Docker is not running',
      body: 'SkillNote needs Docker to run locally (Postgres + API + Web).',
      remediation: [
        'macOS:   open -a Docker',
        'Linux:   sudo systemctl start docker',
        'Windows: Start Docker Desktop from the Start menu',
      ],
      docsUrl: 'https://docs.docker.com/get-docker/',
    })
  }
  if (msg.includes('403 Forbidden') || msg.includes('unauthorized')) {
    throw new UserFacingError({
      header: 'Could not pull SkillNote images from the registry',
      body: [
        'The bundled compose file references images on ghcr.io that this version',
        'may not have published yet (alpha/beta builds may be local-only).',
      ],
      remediation: [
        'Run with --no-pull to use locally built images,',
        'or pull the images manually and retry.',
      ],
    })
  }
  if (msg.includes('manifest unknown') || msg.includes('not found')) {
    throw new UserFacingError({
      header: 'SkillNote image not found in the registry',
      body: `The compose file references an image that doesn't exist: ${extractMissingImage(msg) ?? 'unknown'}`,
      remediation: [
        'If this is a development build, run with --no-pull.',
        'Otherwise, check that you are on a published version.',
      ],
    })
  }
  throw err
}

function extractMissingImage(msg: string): string | null {
  const m = msg.match(/ghcr\.io\/[\w\-/]+:[\w.\-]+/)
  return m ? m[0] : null
}

export async function composePull(
  opts: ComposeOptions,
  onLine?: (line: string) => void,
): Promise<void> {
  const proc = execa('docker', [...composeArgs(opts), 'pull'], {
    env: { ...process.env, ...opts.env, DOCKER_BUILDKIT: '1' },
    reject: false,
  })
  proc.stdout?.on('data', (chunk) => emitLines(chunk, onLine))
  proc.stderr?.on('data', (chunk) => emitLines(chunk, onLine))
  const result = await proc
  if (result.exitCode !== 0) classify(result as unknown as ExecaError)
}

export async function composeUp(
  opts: ComposeOptions,
  onLine?: (line: string) => void,
): Promise<void> {
  // -d (detach) so we don't tail logs from compose — we'll attach our own
  // stream separately. --wait blocks until healthchecks pass.
  const proc = execa('docker', [...composeArgs(opts), 'up', '-d', '--wait'], {
    env: { ...process.env, ...opts.env },
    reject: false,
  })
  proc.stdout?.on('data', (chunk) => emitLines(chunk, onLine))
  proc.stderr?.on('data', (chunk) => emitLines(chunk, onLine))
  const result = await proc
  if (result.exitCode !== 0) classify(result as unknown as ExecaError)
}

export async function composeDown(opts: ComposeOptions, removeVolumes = false): Promise<void> {
  const args = [...composeArgs(opts), 'down']
  if (removeVolumes) args.push('-v')
  const result = await execa('docker', args, {
    env: { ...process.env, ...opts.env },
    reject: false,
  })
  if (result.exitCode !== 0) classify(result as unknown as ExecaError)
}

export async function composePs(opts: ComposeOptions): Promise<ComposeService[]> {
  const result = await execa('docker', [...composeArgs(opts), 'ps', '--format', 'json'], {
    env: { ...process.env, ...opts.env },
    reject: false,
  })
  if (result.exitCode !== 0) classify(result as unknown as ExecaError)
  // Output is one JSON object per line.
  return result.stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ComposeService)
}

export async function composeLogs(
  opts: ComposeOptions,
  service?: string,
  tail = 100,
): Promise<string> {
  const args = [...composeArgs(opts), 'logs', '--tail', String(tail)]
  if (service) args.push(service)
  const result = await execa('docker', args, {
    env: { ...process.env, ...opts.env },
    reject: false,
  })
  if (result.exitCode !== 0) classify(result as unknown as ExecaError)
  return result.stdout
}

export interface ComposeService {
  Name: string
  Service: string
  State: string
  Status: string
  Health?: string
  Publishers?: { URL: string; TargetPort: number; PublishedPort: number; Protocol: string }[]
}

function emitLines(chunk: Buffer | string, onLine?: (line: string) => void): void {
  if (!onLine) return
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/\r$/, '')
    if (trimmed) onLine(trimmed)
  }
}
