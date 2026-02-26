import fs from 'node:fs'
import path from 'node:path'
import type { AgentAdapter } from './types.js'

export class CodexAdapter implements AgentAdapter {
  name = 'codex'
  displayName = 'Codex'

  constructor(private projectDir: string) {}

  detect(): boolean {
    return fs.existsSync(path.join(this.projectDir, '.codex'))
  }

  skillDir(slug: string): string {
    return path.join(this.projectDir, '.codex', 'skills', slug)
  }
}
