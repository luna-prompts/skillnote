import path from 'node:path'
import type { AgentAdapter } from './types.js'

export class UniversalAdapter implements AgentAdapter {
  name = 'universal'
  displayName = 'Universal (.agents/skills/)'

  constructor(private projectDir: string) {}

  detect(): boolean {
    return true
  }

  skillDir(slug: string): string {
    return path.join(this.projectDir, '.agents', 'skills', slug)
  }
}
