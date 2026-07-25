import fs from 'node:fs'
import path from 'node:path'
import type { AgentAdapter } from './types.js'

export class CodexAdapter implements AgentAdapter {
  name = 'codex'
  displayName = 'Codex'
  // One shared directory for every project on the machine — see the
  // reference counting in ../manifest/global-registry.ts.
  scope = 'user' as const

  constructor(private homeDir: string) {}

  detect(): boolean {
    // Codex is installed per-user, not per-project — ~/.codex exists on any
    // machine that has run Codex at least once.
    return fs.existsSync(path.join(this.homeDir, '.codex'))
  }

  skillDir(slug: string): string {
    // ~/.agents/skills is Codex's user-global skill root (its config loader
    // marks ~/.codex/skills as deprecated). Skills land in every workspace;
    // the SkillNote plugin's collection-scoped sync handles per-project dirs.
    return path.join(this.homeDir, '.agents', 'skills', slug)
  }
}
