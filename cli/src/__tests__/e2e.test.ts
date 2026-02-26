import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CLI = path.resolve(__dirname, '../../dist/index.js')
const HOST = process.env.SKILLNOTE_HOST || 'http://localhost:8082'
const TOKEN = process.env.SKILLNOTE_TOKEN || 'skn_dev_demo_token'

function run(args: string, opts?: { cwd?: string; env?: Record<string, string> }): string {
  return execSync(`node ${CLI} ${args}`, {
    encoding: 'utf-8',
    env: {
      ...process.env,
      SKILLNOTE_HOST: HOST,
      SKILLNOTE_TOKEN: TOKEN,
      ...opts?.env,
    },
    cwd: opts?.cwd,
    timeout: 30000,
  }).trim()
}

let tmpProject: string

beforeAll(() => {
  execSync('npm run build', { cwd: path.resolve(__dirname, '../..') })
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'skillnote-e2e-'))
  fs.mkdirSync(path.join(tmpProject, '.claude'))
})

afterAll(() => {
  fs.rmSync(tmpProject, { recursive: true, force: true })
})

describe('CLI E2E', () => {
  it('shows version', () => {
    const out = run('--version')
    expect(out).toBe('0.1.0')
  })

  it('lists skills', () => {
    const out = run('list', { cwd: tmpProject })
    expect(out).toContain('secure-migrations')
  })

  it('adds a skill', () => {
    const out = run('add secure-migrations --agent claude', { cwd: tmpProject })
    expect(out).toContain('installed')
    const skillDir = path.join(tmpProject, '.claude', 'skills', 'secure-migrations')
    expect(fs.existsSync(skillDir)).toBe(true)
    expect(fs.existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true)
  })

  it('checks for updates', () => {
    const out = run('check', { cwd: tmpProject })
    expect(out).toContain('secure-migrations')
    expect(out).toContain('up to date')
  })

  it('removes a skill', () => {
    const out = run('remove secure-migrations', { cwd: tmpProject })
    expect(out).toContain('Removed')
    const skillDir = path.join(tmpProject, '.claude', 'skills', 'secure-migrations')
    expect(fs.existsSync(skillDir)).toBe(false)
  })

  it('runs doctor', () => {
    const out = run('doctor', { cwd: tmpProject })
    expect(out).toContain('Backend reachable')
    expect(out).toContain('Token valid')
  })
})
