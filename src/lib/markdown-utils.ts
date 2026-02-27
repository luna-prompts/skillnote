import { Skill } from './mock-data'

export function generateMarkdown(skill: Skill): string {
  const lines = [
    '---',
    `name: ${skill.slug}`,
    `description: ${skill.description}`,
  ]
  if (skill.tags && skill.tags.length > 0) {
    lines.push(`tags: [${skill.tags.join(', ')}]`)
  }
  if (skill.collections && skill.collections.length > 0) {
    lines.push(`collections: [${skill.collections.join(', ')}]`)
  }
  lines.push('---', '')
  return lines.join('\n') + skill.content_md
}

export function parseMarkdown(raw: string, filename: string): Omit<Skill, 'comments' | 'attachments' | 'revisions'> {
  const now = new Date().toISOString()
  let title = filename.replace(/\.md$/i, '')
  let description = ''
  let tags: string[] = []
  let collections: string[] = []
  let content = raw

  // Parse frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (fmMatch) {
    const fm = fmMatch[1]
    content = raw.slice(fmMatch[0].length)

    // "name" is the skill name — use as title
    const nameMatch = fm.match(/^name:\s*(.+)$/m)
    if (nameMatch) title = nameMatch[1].trim()

    // "title" is a legacy frontmatter field — also use as title
    const titleMatch = fm.match(/^title:\s*(.+)$/m)
    if (titleMatch) title = titleMatch[1].trim()

    // Extract description from frontmatter
    const descMatch = fm.match(/^description:\s*(.+)$/m)
    if (descMatch) description = descMatch[1].trim()

    const tagsMatch = fm.match(/^tags:\s*\[([^\]]*)\]$/m)
    if (tagsMatch) {
      tags = tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean)
    }

    const colMatch = fm.match(/^collections:\s*\[([^\]]*)\]$/m)
    if (colMatch) {
      collections = colMatch[1].split(',').map(c => c.trim()).filter(Boolean)
    }
  }

  // Fallback: extract title from first H1 if no frontmatter name/title
  if (title === filename.replace(/\.md$/i, '')) {
    const h1Match = content.match(/^#\s+(.+)$/m)
    if (h1Match) title = h1Match[1].trim()
  }

  // Fallback description from content if not in frontmatter
  if (!description) {
    description = content.slice(0, 150).replace(/[#\n]/g, ' ').trim()
  }

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return {
    slug,
    title,
    description,
    content_md: content.trim(),
    tags,
    collections,
    current_version: 1,
    latest_version: 1,
    created_at: now,
    updated_at: now,
  }
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
