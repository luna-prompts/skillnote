import fs from 'node:fs'
import path from 'node:path'
import type { AgentAdapter } from './types.js'

export class ClaudeAdapter implements AgentAdapter {
  name = 'claude'
  displayName = 'Claude Code'

  constructor(private projectDir: string) {}

  detect(): boolean {
    return fs.existsSync(path.join(this.projectDir, '.claude'))
  }

  skillDir(slug: string): string {
    return path.join(this.projectDir, '.claude', 'skills', slug)
  }
}
