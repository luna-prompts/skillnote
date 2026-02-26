import chalk from 'chalk'
import ora, { type Ora } from 'ora'

export function success(msg: string): void {
  console.log(chalk.green('✓') + ' ' + msg)
}

export function fail(msg: string): void {
  console.log(chalk.red('✗') + ' ' + msg)
}

export function warn(msg: string): void {
  console.log(chalk.yellow('⚠') + ' ' + msg)
}

export function info(msg: string): void {
  console.log(chalk.cyan('ℹ') + ' ' + msg)
}

export function dim(msg: string): string {
  return chalk.dim(msg)
}

export function bold(msg: string): string {
  return chalk.bold(msg)
}

export function spinner(text: string): Ora {
  return ora({ text, color: 'cyan' })
}

export function table(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
  )
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length))
  console.log(headers.map((h, i) => chalk.dim(pad(h, widths[i]))).join('  '))
  for (const row of rows) {
    console.log(row.map((c, i) => pad(c, widths[i])).join('  '))
  }
}
