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

/** Strip YAML frontmatter — return only the body */
export function stripFrontmatter(md: string): string {
  const { body } = parseFrontmatter(md)
  return body
}
