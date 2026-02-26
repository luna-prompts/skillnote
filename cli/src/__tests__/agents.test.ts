import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('agent adapters', () => {
  it('detects Claude Code when .claude/ exists', async () => {
    const { ClaudeAdapter } = await import('../agents/claude.js')
    const adapter = new ClaudeAdapter(tmpDir)
    expect(adapter.detect()).toBe(false)

    fs.mkdirSync(path.join(tmpDir, '.claude'))
    expect(adapter.detect()).toBe(true)
  })

  it('returns correct skill dir for Claude', async () => {
    const { ClaudeAdapter } = await import('../agents/claude.js')
    const adapter = new ClaudeAdapter(tmpDir)
    expect(adapter.skillDir('my-skill')).toBe(path.join(tmpDir, '.claude', 'skills', 'my-skill'))
  })

  it('detects OpenClaw when ~/.openclaw/ exists', async () => {
    const { OpenClawAdapter } = await import('../agents/openclaw.js')
    const fakeHome = path.join(tmpDir, 'fakehome')
    fs.mkdirSync(fakeHome)
    const adapter = new OpenClawAdapter(tmpDir, fakeHome)
    expect(adapter.detect()).toBe(false)

    fs.mkdirSync(path.join(fakeHome, '.openclaw'))
    expect(adapter.detect()).toBe(true)
  })

  it('installs OpenClaw skills to workspace skills/ dir', async () => {
    const { OpenClawAdapter } = await import('../agents/openclaw.js')
    const adapter = new OpenClawAdapter(tmpDir, tmpDir)
    expect(adapter.skillDir('my-skill')).toBe(path.join(tmpDir, 'skills', 'my-skill'))
  })

  it('detectAll returns only detected agents', async () => {
    const { detectAgents } = await import('../agents/index.js')
    fs.mkdirSync(path.join(tmpDir, '.claude'))
    const detected = detectAgents(tmpDir, tmpDir)
    const names = detected.map(a => a.name)
    expect(names).toContain('claude')
    expect(names).not.toContain('cursor')
    expect(names).toContain('universal')
  })
})
