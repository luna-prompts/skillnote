import fs from 'node:fs'
import path from 'node:path'
import type { AgentAdapter } from './types.js'

export class OpenHandsAdapter implements AgentAdapter {
  name = 'openhands'
  displayName = 'OpenHands'

  constructor(private projectDir: string) {}

  detect(): boolean {
    return fs.existsSync(path.join(this.projectDir, '.openhands'))
  }

  skillDir(slug: string): string {
    return path.join(this.projectDir, '.openhands', 'skills', slug)
  }
}
