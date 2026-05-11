import { c } from './theme.js'

export interface PrettyErrorOptions {
  header: string
  body?: string | string[]
  remediation?: string | string[]
  docsUrl?: string
}

/**
 * Render a user-facing error message with consistent structure:
 *
 *   ✗  <header>
 *
 *      <body line 1>
 *      <body line 2>
 *
 *      <remediation line 1>
 *      <remediation line 2>
 *
 *      docs: <url>
 *
 * The shape matches the Trigger.dev / Wrangler precedent: signal the error,
 * say what happened, say what to do, link to more. Never just "Error: foo".
 */
export function prettyError(opts: PrettyErrorOptions): string {
  const parts: string[] = []
  parts.push(`  ${c.err('✗')}  ${c.bold(opts.header)}`)
  if (opts.body) {
    parts.push('')
    for (const line of asLines(opts.body)) {
      parts.push(`     ${line}`)
    }
  }
  if (opts.remediation) {
    parts.push('')
    for (const line of asLines(opts.remediation)) {
      parts.push(`     ${line}`)
    }
  }
  if (opts.docsUrl) {
    parts.push('')
    parts.push(`     ${c.dim('docs:')} ${c.info(opts.docsUrl)}`)
  }
  parts.push('')
  return parts.join('\n')
}

function asLines(input: string | string[]): string[] {
  if (Array.isArray(input)) return input
  return input.split('\n')
}

// Convenience: every public error class extends this so the CLI's top-level
// catch can render them with prettyError instead of a stack trace.
export class UserFacingError extends Error {
  readonly options: PrettyErrorOptions
  constructor(options: PrettyErrorOptions) {
    super(options.header)
    this.name = 'UserFacingError'
    this.options = options
  }
}
