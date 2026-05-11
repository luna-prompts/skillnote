import { type ComposeOptions, ensureComposeExtracted } from '../docker/compose.js'
import { type ServiceHealth, snapshot } from '../docker/health.js'
import { isDockerRunning } from '../docker/inspect.js'
import { pkgInfo } from '../lib/package-info.js'
import { loadConfig } from '../state/config.js'
import { loadState } from '../state/state.js'
import { prettyError } from '../ui/errors.js'
import { serviceTable } from '../ui/table.js'
import { c, dot } from '../ui/theme.js'

export interface StatusOptions {
  json?: boolean
}

export async function statusCommand(opts: StatusOptions = {}): Promise<void> {
  const state = await loadState()
  const config = await loadConfig()
  const docker = await isDockerRunning()

  let services: ServiceHealth[] = []
  if (docker.ok) {
    try {
      const composeFile = await ensureComposeExtracted(pkgInfo.version)
      const composeOpts: ComposeOptions = { composeFile }
      services = await snapshot(composeOpts)
    } catch {
      // No containers up — that's a valid state, services = [].
    }
  }

  const running = services.filter((s) => s.state === 'running')
  const isUp = running.length > 0

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          version: pkgInfo.version,
          docker: { running: docker.ok, version: docker.version ?? null },
          running: isUp,
          services,
          config: {
            webPort: config.webPort,
            apiPort: config.apiPort,
            host: config.host,
          },
          state: {
            firstStart: state.firstStart ?? null,
            lastStart: state.lastStart ?? null,
            totalStarts: state.totalStarts,
            pendingUpdate: state.pendingUpdate ?? null,
          },
        },
        null,
        2,
      )}\n`,
    )
    return
  }

  if (!docker.ok) {
    process.stderr.write(
      prettyError({
        header: 'Docker is not running',
        body: 'Cannot determine SkillNote status without Docker.',
        remediation: [
          'macOS:   open -a Docker',
          'Linux:   sudo systemctl start docker',
          'Windows: Start Docker Desktop from the Start menu',
        ],
      }),
    )
    process.exitCode = 1
    return
  }

  process.stdout.write(
    `\n  ${c.brandBold('SkillNote')} ${c.muted('▸')} ${isUp ? c.ok('running') : c.muted('stopped')} ` +
      `${c.dim(`· v${pkgInfo.version}`)}\n\n`,
  )

  if (!isUp) {
    process.stdout.write(
      `  ${c.muted('No containers up.')} Run ${c.brand('skillnote start')} to launch.\n\n`,
    )
    return
  }

  process.stdout.write(
    `${serviceTable(
      services.map((s) => ({
        service: s.service,
        health: healthLabel(s),
        meta: s.status,
      })),
    )}\n`,
  )

  process.stdout.write('\n')
  process.stdout.write(`  ${c.muted('Web UI:')} ${c.brand(`http://localhost:${config.webPort}`)}\n`)
  process.stdout.write(
    `  ${c.muted('API:   ')} ${c.brand(`http://localhost:${config.apiPort}`)}\n\n`,
  )

  if (state.pendingUpdate) {
    process.stdout.write(
      `  ${c.warn(`Update available: v${state.pendingUpdate}`)} — run ${c.brand('skillnote update')}\n\n`,
    )
  }
}

function healthLabel(s: ServiceHealth): string {
  switch (s.health) {
    case 'healthy':
      return `${dot.ok} ${c.ok('healthy')}`
    case 'starting':
      return `${dot.pending} ${c.warn('starting')}`
    case 'unhealthy':
      return `${dot.err} ${c.err('unhealthy')}`
    case 'absent':
      return `${dot.off} ${c.muted('absent')}`
    default:
      return s.state === 'running'
        ? `${dot.ok} ${c.muted('running')}`
        : `${dot.off} ${c.muted(s.state)}`
  }
}
