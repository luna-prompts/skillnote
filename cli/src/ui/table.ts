import Table from 'cli-table3'
import { c } from './theme.js'

// URL summary table shown after a successful start.
export function urlTable(rows: { label: string; url: string }[]): string {
  const table = new Table({
    chars: tableChars,
    style: { 'padding-left': 1, 'padding-right': 1, head: [], border: [] },
  })
  for (const { label, url } of rows) {
    table.push([c.muted(label), c.brand(url)])
  }
  return table.toString()
}

// Agent connection status table for `skillnote status`.
export function agentTable(
  rows: { agent: string; status: string; lastActivity: string }[],
): string {
  const table = new Table({
    head: [c.muted('Agent'), c.muted('Status'), c.muted('Last activity')],
    chars: tableChars,
    style: { 'padding-left': 1, 'padding-right': 1, head: [], border: [] },
  })
  for (const { agent, status, lastActivity } of rows) {
    table.push([agent, status, c.dim(lastActivity)])
  }
  return table.toString()
}

// Service health summary.
export function serviceTable(rows: { service: string; health: string; meta?: string }[]): string {
  const table = new Table({
    chars: tableChars,
    style: { 'padding-left': 1, 'padding-right': 1, head: [], border: [] },
  })
  for (const { service, health, meta } of rows) {
    table.push([c.muted(service), health, c.dim(meta ?? '')])
  }
  return table.toString()
}

const tableChars = {
  top: '─',
  'top-mid': '┬',
  'top-left': '╭',
  'top-right': '╮',
  bottom: '─',
  'bottom-mid': '┴',
  'bottom-left': '╰',
  'bottom-right': '╯',
  left: '│',
  'left-mid': '├',
  mid: '─',
  'mid-mid': '┼',
  right: '│',
  'right-mid': '┤',
  middle: '│',
}
