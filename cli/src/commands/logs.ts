import { execa } from 'execa'
import { ensureComposeExtracted } from '../docker/compose.js'
import { requireDocker } from '../docker/inspect.js'
import { pkgInfo } from '../lib/package-info.js'
import { UserFacingError, prettyError } from '../ui/errors.js'
import { c } from '../ui/theme.js'

export interface LogsOptions {
  service?: string
  tail?: number
  follow?: boolean
}

// Per-service color so multi-service log streams are easy to parse visually.
const serviceColors: Record<string, (s: string) => string> = {
  postgres: c.accent,
  api: c.info,
  web: c.brand,
}

export async function logsCommand(opts: LogsOptions = {}): Promise<void> {
  try {
    await requireDocker()
    const composeFile = await ensureComposeExtracted(pkgInfo.version)

    const args = [
      'compose',
      '--project-name',
      'skillnote',
      '-f',
      composeFile,
      'logs',
      '--tail',
      String(opts.tail ?? 100),
    ]
    if (opts.follow) args.push('--follow', '--no-log-prefix')
    if (opts.service) args.push(opts.service)

    // For follow mode, stream straight through with color injection.
    if (opts.follow) {
      const proc = execa('docker', args, { stdio: ['inherit', 'pipe', 'inherit'] })
      proc.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        for (const raw of text.split('\n')) {
          if (!raw) continue
          process.stdout.write(`${colorize(raw, opts.service)}\n`)
        }
      })
      await proc
      return
    }

    const result = await execa('docker', args, { reject: false })
    if (result.exitCode !== 0) {
      throw new UserFacingError({
        header: 'Failed to read logs',
        body: result.stderr || 'docker compose logs exited with a non-zero status.',
        remediation: 'Run `skillnote status` to confirm services are running.',
      })
    }
    const lines = result.stdout.split('\n').filter((l) => l.length > 0)
    if (lines.length === 0) {
      // compose returns 0 with empty stdout when no containers exist for the
      // project — surface that explicitly instead of leaving the user staring
      // at a blank terminal wondering if the command worked.
      process.stdout.write(
        `${c.muted('No logs. SkillNote may not be running — try')} ${c.brand('skillnote start')}${c.muted('.')}\n`,
      )
      return
    }
    for (const line of lines) {
      process.stdout.write(`${colorize(line, opts.service)}\n`)
    }
  } catch (err) {
    if (err instanceof UserFacingError) {
      process.stderr.write(`\n${prettyError(err.options)}`)
      process.exitCode = 1
      return
    }
    throw err
  }
}

function colorize(line: string, hintedService?: string): string {
  // docker compose emits "service-1  | message" by default; isolate the prefix.
  const match = line.match(/^([a-z0-9_-]+)(?:-\d+)?\s+\|\s+(.*)$/)
  if (match) {
    const service = match[1] ?? ''
    const message = match[2] ?? ''
    const color = serviceColors[service] ?? c.muted
    return `${color(service.padEnd(8))} ${c.dim('│')} ${message}`
  }
  if (hintedService) {
    const color = serviceColors[hintedService] ?? c.muted
    return `${color(hintedService.padEnd(8))} ${c.dim('│')} ${line}`
  }
  return line
}
