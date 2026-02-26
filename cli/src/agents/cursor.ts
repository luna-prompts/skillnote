import fs from 'node:fs'
import path from 'node:path'
import type { AgentAdapter } from './types.js'

export class CursorAdapter implements AgentAdapter {
  name = 'cursor'
  displayName = 'Cursor'

  constructor(private projectDir: string) {}

  detect(): boolean {
    return (
      fs.existsSync(path.join(this.projectDir, '.cursor')) ||
      fs.existsSync(path.join(this.projectDir, '.cursorrules'))
    )
  }

  skillDir(slug: string): string {
    return path.join(this.projectDir, '.cursor', 'skills', slug)
  }
}
