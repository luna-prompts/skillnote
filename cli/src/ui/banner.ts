import { c, logo } from './theme.js'

// First-run welcome banner — shown once per machine, suppressed afterward via
// `state.seenWelcome`.
export function welcomeBanner(version: string): string {
  const inner = [
    '',
    `  ${logo()}  the skill registry for AI agents`,
    `  ${c.muted(`v${version} · github.com/luna-prompts/skillnote`)}`,
    '',
  ]
  const width = 60
  const top = `  ${c.muted(`┌${'─'.repeat(width)}┐`)}`
  const bot = `  ${c.muted(`└${'─'.repeat(width)}┘`)}`
  const sides = inner.map((line) => `  ${c.muted('│')}${padLine(line, width)}${c.muted('│')}`)
  return [top, ...sides, bot].join('\n')
}

// Compact banner for subsequent runs — just logo + version + optional update hint.
export function compactBanner(version: string, updateAvailable?: string): string {
  let line = `  ${logo()} ${c.muted(`v${version}`)}`
  if (updateAvailable) {
    line += `  ${c.warn(`update available: v${updateAvailable}`)}`
  }
  return line
}

function padLine(content: string, width: number): string {
  // Account for ANSI escape codes when computing visible length.
  const visible = stripAnsi(content)
  const padNeeded = Math.max(0, width - visible.length)
  return content + ' '.repeat(padNeeded)
}

// Local, dependency-free strip-ansi so this module stays cheap to import in tests.
function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require control chars
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}
