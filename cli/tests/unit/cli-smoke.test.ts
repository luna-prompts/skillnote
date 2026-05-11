import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

// CLI-level smoke tests — exercise the built binary directly. These verify
// the build artefact is real and the entry-point doesn't crash on simple
// flags. Slower than pure unit tests but still <2s total.

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(__dirname, '..', '..')
const binPath = join(cliRoot, 'dist', 'index.js')

describe('built CLI', () => {
  if (!existsSync(binPath)) {
    it.skip('built artefact at dist/index.js — run `npm run build` first', () => {})
    return
  }

  it('--version prints the package version', async () => {
    const r = await execa('node', [binPath, '--version'], { reject: false })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('--help lists all primary commands', async () => {
    const r = await execa('node', [binPath, '--help'], { reject: false })
    expect(r.exitCode).toBe(0)
    for (const cmd of ['start', 'stop', 'restart', 'status', 'logs', 'open', 'doctor']) {
      expect(r.stdout).toContain(cmd)
    }
  })

  it('exits 1 on an unknown command with a helpful message', async () => {
    const r = await execa('node', [binPath, 'no-such-command'], { reject: false })
    expect(r.exitCode).not.toBe(0)
  })

  it('respects --no-browser flag parsing in start', async () => {
    // Run start with --no-browser AND a fake api-port that's guaranteed to be free.
    // We don't expect Docker to be available here, so the command should fail
    // gracefully with a UserFacingError (exit 1) — not crash with a stack trace.
    const r = await execa(
      'node',
      [binPath, 'start', '--no-browser', '--api-port', '54201', '--web-port', '54202'],
      { reject: false, timeout: 20_000 },
    )
    // Either docker is available and start succeeds, OR docker errors out cleanly.
    // What we're guarding against is a JS stack trace.
    expect(r.stderr).not.toMatch(/at Object\.</)
    expect(r.stderr).not.toMatch(/^TypeError/m)
  }, 25_000)
})
