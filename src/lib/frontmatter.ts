import yaml from 'js-yaml'

export interface FrontmatterResult {
  data: Record<string, unknown>
  body: string
}

/** Parse YAML frontmatter block and return its data + the remaining body */
export function parseFrontmatter(md: string): FrontmatterResult {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { data: {}, body: md }
  try {
    const data = (yaml.load(match[1]) as Record<string, unknown>) ?? {}
    const body = md.slice(match[0].length)
    return { data, body }
  } catch {
    return { data: {}, body: md }
  }
}

/** Convert frontmatter data to a GitHub-style GFM table string */
export function frontmatterToTable(data: Record<string, unknown>): string {
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined)
  if (entries.length === 0) return ''

  const headers = entries.map(([k]) => k)
  const values = entries.map(([, v]) => {
    if (typeof v === 'object') return '`' + JSON.stringify(v) + '`'
    return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  })

  const header = '| ' + headers.join(' | ') + ' |'
  const divider = '| ' + headers.map(() => '---').join(' | ') + ' |'
  const row = '| ' + values.join(' | ') + ' |'

  return [header, divider, row].join('\n')
}

/**
 * Transform a markdown string:
 * - If frontmatter present → replace it with a GFM table
 * - Otherwise → return as-is
 */
export function transformFrontmatterToTable(md: string): string {
  const { data, body } = parseFrontmatter(md)
  if (Object.keys(data).length === 0) return md
  const table = frontmatterToTable(data)
  return table ? table + '\n\n' + body : body
}

/** Strip YAML frontmatter — return only the body */
export function stripFrontmatter(md: string): string {
  const { body } = parseFrontmatter(md)
  return body
}
