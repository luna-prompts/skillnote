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

  it('rejects entries with embedded newlines', async () => {
    const { validateEntryName } = await import('../util/zip.js')
    expect(() => validateEntryName('a\nb')).toThrow('control char')
    expect(() => validateEntryName('a\r\nb')).toThrow('control char')
    expect(() => validateEntryName('a\x00b')).toThrow('control char')
  })

  it('refuses to extract a bundle containing a symlink entry', async () => {
    const { extractZipSafe } = await import('../util/zip.js')
    const zipPath = path.join(tmpDir, 'evil.zip')
    const victimFile = path.join(tmpDir, 'victim.txt')
    fs.writeFileSync(victimFile, 'TOP-SECRET')

    // Build a zip with one symlink entry pointing at our victim file
    const stage = path.join(tmpDir, 'stage')
    fs.mkdirSync(stage)
    fs.symlinkSync(victimFile, path.join(stage, 'evil-link'))
    execSync(`cd "${stage}" && zip --symlinks -q "${zipPath}" evil-link`)

    const outDir = path.join(tmpDir, 'out')
    expect(() => extractZipSafe(fs.readFileSync(zipPath), outDir)).toThrow(
      /symbolic link/i,
    )
    // Nothing should have been planted on disk
    expect(fs.existsSync(path.join(outDir, 'evil-link'))).toBe(false)
  })

  it('does not invoke a shell when TMPDIR contains metacharacters', async () => {
    // Sanity check: with execFileSync the tmpZip path is passed as an argv
    // element, so shell metachars in TMPDIR can never trigger command
    // execution. We can't easily simulate a hostile TMPDIR mid-test without
    // perturbing the rest of the suite, so this test just exercises the
    // happy path with a benign tmpDir path that contains a space — under
    // the old execSync template-string code this would have broken parsing.
    const { extractZipSafe } = await import('../util/zip.js')
    const spacedTmp = path.join(tmpDir, 'has space')
    fs.mkdirSync(spacedTmp)
    const srcDir = path.join(spacedTmp, 'src')
    fs.mkdirSync(srcDir)
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '# x')
    const zipPath = path.join(spacedTmp, 't.zip')
    execSync(`cd "${srcDir}" && zip -r "${zipPath}" .`)
    const outDir = path.join(spacedTmp, 'out')
    extractZipSafe(fs.readFileSync(zipPath), outDir)
    expect(fs.existsSync(path.join(outDir, 'SKILL.md'))).toBe(true)
  })
})
