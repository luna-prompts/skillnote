import chalk from 'chalk'

// SkillNote brand colors — picked to match the web UI accent.
export const brand = {
  primary: '#14b8a6', // teal-500
  secondary: '#8b5cf6', // violet-500
  success: '#10b981', // emerald-500
  warning: '#f59e0b', // amber-500
  error: '#ef4444', // red-500
  info: '#3b82f6', // blue-500
  muted: '#71717a', // zinc-500
  subtle: '#a1a1aa', // zinc-400
} as const

export const c = {
  brand: chalk.hex(brand.primary),
  brandBold: chalk.hex(brand.primary).bold,
  accent: chalk.hex(brand.secondary),
  ok: chalk.hex(brand.success),
  warn: chalk.hex(brand.warning),
  err: chalk.hex(brand.error),
  info: chalk.hex(brand.info),
  muted: chalk.hex(brand.muted),
  dim: chalk.hex(brand.subtle),
  bold: chalk.bold,
  underline: chalk.underline,
}

// Status dot characters used across the CLI for service health.
export const dot = {
  ok: c.ok('●'),
  warn: c.warn('●'),
  err: c.err('●'),
  off: c.muted('○'),
  pending: c.dim('◌'),
} as const

// Logo as the user sees it in the banner.
export function logo(): string {
  return `${c.brandBold('SkillNote')} ${c.muted('▸')}`
}
