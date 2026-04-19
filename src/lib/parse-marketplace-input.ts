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
    // GitHub tree/blob URL — captures explicit ref + optional subpath.
    // Backend extracts the subpath; frontend just shows the github chip.
    const ghTree = url.match(
      /^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/]+?)\/(?:tree|blob)\/([^/]+)(?:\/(.*?))?\/?$/,
    )
    if (ghTree) {
      return { source_type: 'github', repo: ghTree[1].replace(/\.git$/, ''), ref: ghTree[2] }
    }
    const gh = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/]+?)(?:\/|\.git)?\/?$/)
    if (gh) {
      return { source_type: 'github', repo: gh[1].replace(/\.git$/, ''), ...(ref ? { ref } : {}) }
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
