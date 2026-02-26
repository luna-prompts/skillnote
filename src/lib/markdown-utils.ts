import { Skill } from './mock-data'

export function generateMarkdown(skill: Skill): string {
  const frontmatter = [
    '---',
    `name: ${skill.slug}`,
    `description: ${skill.description}`,
    '---',
    '',
  ].join('\n')
  return frontmatter + skill.content_md
}

export function parseMarkdown(raw: string, filename: string): Omit<Skill, 'comments' | 'attachments' | 'revisions'> {
  const now = new Date().toISOString()
  let title = filename.replace(/\.md$/i, '')
  let tags: string[] = []
  let content = raw

  // Parse frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (fmMatch) {
    const fm = fmMatch[1]
    content = raw.slice(fmMatch[0].length)

    // Support both "name" (SKILL.md spec) and "title" (legacy) frontmatter
    const nameMatch = fm.match(/^name:\s*(.+)$/m)
    if (nameMatch) title = nameMatch[1].trim()
    const titleMatch = fm.match(/^title:\s*(.+)$/m)
    if (titleMatch && !nameMatch) title = titleMatch[1].trim()

    const tagsMatch = fm.match(/^tags:\s*\[([^\]]*)\]$/m)
    if (tagsMatch) {
      tags = tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean)
    }
  }

  // Fallback: extract title from first H1
  if (!title || title === filename.replace(/\.md$/i, '')) {
    const h1Match = content.match(/^#\s+(.+)$/m)
    if (h1Match) title = h1Match[1].trim()
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
    description: content.slice(0, 150).replace(/[#\n]/g, ' ').trim(),
    content_md: content.trim(),
    tags,
    collections: [],
    current_version: 0,
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
