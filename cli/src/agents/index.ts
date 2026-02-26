import os from 'node:os'
import type { AgentAdapter } from './types.js'
import { ClaudeAdapter } from './claude.js'
import { CursorAdapter } from './cursor.js'
import { CodexAdapter } from './codex.js'
import { OpenClawAdapter } from './openclaw.js'
import { OpenHandsAdapter } from './openhands.js'
import { UniversalAdapter } from './universal.js'

export type { AgentAdapter }

export function allAdapters(projectDir: string, homeDir?: string): AgentAdapter[] {
  const home = homeDir ?? os.homedir()
  return [
    new ClaudeAdapter(projectDir),
    new CursorAdapter(projectDir),
    new CodexAdapter(projectDir),
    new OpenClawAdapter(projectDir, home),
    new OpenHandsAdapter(projectDir),
    new UniversalAdapter(projectDir),
  ]
}

export function detectAgents(projectDir: string, homeDir?: string): AgentAdapter[] {
  return allAdapters(projectDir, homeDir).filter(a => a.detect())
}

export function getAdapter(name: string, projectDir: string, homeDir?: string): AgentAdapter | undefined {
  return allAdapters(projectDir, homeDir).find(a => a.name === name)
}
