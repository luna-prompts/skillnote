import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import os from 'node:os'

export function validateEntryName(name: string): void {
  if (name.includes('..')) {
    throw new Error(`Unsafe zip entry: path traversal detected in "${name}"`)
  }
  if (path.isAbsolute(name)) {
    throw new Error(`Unsafe zip entry: absolute path detected in "${name}"`)
  }
}

export function extractZipSafe(zipBuffer: Buffer, destDir: string): void {
  const tmpZip = path.join(os.tmpdir(), `skillnote-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`)
  try {
    fs.writeFileSync(tmpZip, zipBuffer)

    const listOutput = execSync(`unzip -l "${tmpZip}"`, { encoding: 'utf-8' })
    const lines = listOutput.split('\n')
    for (const line of lines) {
      const match = /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/.exec(line)
      if (match) {
        validateEntryName(match[1].trim())
      }
    }

    fs.mkdirSync(destDir, { recursive: true })
    execSync(`unzip -o "${tmpZip}" -d "${destDir}"`, { stdio: 'pipe' })
  } finally {
    fs.rmSync(tmpZip, { force: true })
  }
}
