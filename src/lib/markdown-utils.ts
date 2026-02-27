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
  let slugHint = ''
  let description = ''
  let tags: string[] = []
  let content = raw

  // Parse frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (fmMatch) {
    const fm = fmMatch[1]
    content = raw.slice(fmMatch[0].length)

    // "name" is the slug identifier in SKILL.md spec
    const nameMatch = fm.match(/^name:\s*(.+)$/m)
    if (nameMatch) slugHint = nameMatch[1].trim()

    // "title" is a legacy frontmatter field — use as display title
    const titleMatch = fm.match(/^title:\s*(.+)$/m)
    if (titleMatch) title = titleMatch[1].trim()

    // Extract description from frontmatter
    const descMatch = fm.match(/^description:\s*(.+)$/m)
    if (descMatch) description = descMatch[1].trim()

    const tagsMatch = fm.match(/^tags:\s*\[([^\]]*)\]$/m)
    if (tagsMatch) {
      tags = tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean)
    }
  }

  // Always try to extract display title from first H1 (preferred over slug-like "name")
  const h1Match = content.match(/^#\s+(.+)$/m)
  if (h1Match) title = h1Match[1].trim()

  // If no H1 and no title frontmatter, humanize the name/filename
  if (title === filename.replace(/\.md$/i, '') && slugHint) {
    title = slugHint.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  // Fallback description from content if not in frontmatter
  if (!description) {
    description = content.slice(0, 150).replace(/[#\n]/g, ' ').trim()
  }

  // Use name from frontmatter as slug if available, otherwise derive from title
  const slug = slugHint || title
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
