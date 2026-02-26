import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { AgentAdapter } from './types.js'

export class OpenClawAdapter implements AgentAdapter {
  name = 'openclaw'
  displayName = 'OpenClaw'

  constructor(
    private projectDir: string,
    private homeDir: string = os.homedir(),
  ) {}

  detect(): boolean {
    return fs.existsSync(path.join(this.homeDir, '.openclaw'))
  }

  skillDir(slug: string): string {
    return path.join(this.projectDir, 'skills', slug)
  }
}
