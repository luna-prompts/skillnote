export type ParsedSource =
  | { source_type: 'github'; repo: string; ref?: string }
  | { source_type: 'git'; url: string; ref?: string }
  | { source_type: 'url'; url: string }
  | { source_type: 'directory'; path: string }
  | { error: string }
  | null

const SSH_RE = /^([a-zA-Z0-9._-]+@[^:]+:.+?(?:\.git)?)(#(.+))?$/
const REF_RE = /^([^#@]+)(?:[#@](.+))?$/

export function parseMarketplaceInput(raw: string): ParsedSource {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.includes('\n') || trimmed.includes('\0')) return null

  const sshMatch = trimmed.match(SSH_RE)
  if (sshMatch?.[1]) {
    return sshMatch[3]
      ? { source_type: 'git', url: sshMatch[1], ref: sshMatch[3] }
      : { source_type: 'git', url: sshMatch[1] }
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const [url, ref] = trimmed.split('#')
    if (url.endsWith('.git') || url.includes('/_git/')) {
      return ref ? { source_type: 'git', url, ref } : { source_type: 'git', url }
    }
    const gh = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/]+?)(?:\/|\.git)?\/?$/)
    if (gh) {
      const gitUrl = url.endsWith('.git') ? url : `${url}.git`
      return ref ? { source_type: 'git', url: gitUrl, ref } : { source_type: 'git', url: gitUrl }
    }
    return { source_type: 'url', url }
  }

  if (trimmed.includes('/') && !trimmed.startsWith('@')) {
    if (trimmed.includes(':')) return null
    const m = trimmed.match(REF_RE)
    if (m) {
      const repo = m[1]
      if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) return null
      return m[2]
        ? { source_type: 'github', repo, ref: m[2] }
        : { source_type: 'github', repo }
    }
  }
  return null
}
