import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('extractZipSafe', () => {
  it('extracts a valid zip', async () => {
    const { extractZipSafe } = await import('../util/zip.js')
    const srcDir = path.join(tmpDir, 'src')
    fs.mkdirSync(srcDir)
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '# Test Skill')
    const zipPath = path.join(tmpDir, 'test.zip')
    execSync(`cd "${srcDir}" && zip -r "${zipPath}" .`)

    const outDir = path.join(tmpDir, 'out')
    extractZipSafe(fs.readFileSync(zipPath), outDir)

    expect(fs.existsSync(path.join(outDir, 'SKILL.md'))).toBe(true)
    expect(fs.readFileSync(path.join(outDir, 'SKILL.md'), 'utf-8')).toBe('# Test Skill')
  })

  it('rejects path traversal entries', async () => {
    const { validateEntryName } = await import('../util/zip.js')
    expect(() => validateEntryName('../etc/passwd')).toThrow('traversal')
    expect(() => validateEntryName('/absolute/path')).toThrow('absolute')
  })
})
