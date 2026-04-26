import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import os from 'node:os'

export function validateEntryName(name: string): void {
  if (name.includes('..')) {
    throw new Error(`Unsafe zip entry: path traversal detected in "${name}"`)
  }
  if (path.isAbsolute(name)) {
    throw new Error(`Unsafe zip entry: absolute path detected in "${name}"`)
  }
  // Embedded newlines/NULs let an entry split a tool's listing output and
  // smuggle a second name past line-based validators.
  if (/[\n\r\x00]/.test(name)) {
    throw new Error(`Unsafe zip entry: control char in "${name}"`)
  }
}

// Parse `unzip -Z` output. Each entry line begins with a 10-char mode field.
// Symlink entries always start with 'l'. Other types: '-' (regular file), 'd'
// (directory), '?' (unknown — happens for entries written with no Unix mode,
// e.g. Python's zipfile.writestr() defaulting to create_system=0).
//
// We grep the mode column rather than the filename so a malicious bundle
// can't sneak a symlink in under a benign-looking name.
function parseZipInfo(zipPath: string): Array<{ mode: string; name: string }> {
  const out = execFileSync('unzip', ['-Z', zipPath], { encoding: 'utf-8' })
  const entries: Array<{ mode: string; name: string }> = []
  for (const line of out.split('\n')) {
    // Match any 10-char mode + a date column further along. The mode chars
    // can include any common type bit; the perm bits include r/w/x/-/?.
    const m = /^([?\-lds bcps])([rwx\-?]{9})\s+\d/.exec(line)
    if (!m) continue
    // Filename is everything after the date/time column. Strict format:
    // <mode> <ver> <os> <size> <text> <method> <date> <time> <name>
    const parts = line.trim().split(/\s+/)
    if (parts.length < 9) continue
    const name = parts.slice(8).join(' ')
    entries.push({ mode: m[1] + m[2], name })
  }
  return entries
}

export function extractZipSafe(zipBuffer: Buffer, destDir: string): void {
  const tmpZip = path.join(
    os.tmpdir(),
    `skillnote-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`,
  )
  try {
    fs.writeFileSync(tmpZip, zipBuffer)

    const entries = parseZipInfo(tmpZip)
    if (entries.length === 0) {
      throw new Error('Archive appears empty or unreadable')
    }
    for (const { mode, name } of entries) {
      if (mode.startsWith('l')) {
        throw new Error(`Unsafe zip entry: symbolic link "${name}"`)
      }
      validateEntryName(name)
    }

    fs.mkdirSync(destDir, { recursive: true })
    execFileSync('unzip', ['-o', tmpZip, '-d', destDir], { stdio: 'pipe' })
  } finally {
    fs.rmSync(tmpZip, { force: true })
  }
}
