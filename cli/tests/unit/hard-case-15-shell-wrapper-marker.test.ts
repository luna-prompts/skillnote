/**
 * Hard case #15 — Shell wrapper installed twice.
 *
 * The setup script in backend/app/api/setup.py wraps `claude()` in the user's
 * shell rc file. To make re-installs idempotent, every wrapper block is
 * fenced with EXPLICIT BEGIN/END markers:
 *
 *   # >>> SKILLNOTE WRAPPER BEGIN (do not edit; managed by skillnote setup)
 *   ...
 *   # <<< SKILLNOTE WRAPPER END
 *
 * The setup script's WRAPCLEAN_EOF python heredoc uses a regex to scrub any
 * existing block by these markers. If the marker text drifts (typo, casing
 * change, or a forgotten rename), the regex stops matching and re-installs
 * silently append a SECOND wrapper — and now `claude()` is defined twice.
 *
 * This test pins the marker format down. ANY change to the marker text in
 * setup.py without updating this test's fixture means the regression-only
 * test fails — forcing the author to acknowledge they're breaking the
 * cleanup path for every existing install in the wild.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Canonical marker strings. If you change these, you are breaking idempotency
// for every existing v3+ install. Update both the source AND this fixture.
const EXPECTED_BEGIN_MARKER =
  '# >>> SKILLNOTE WRAPPER BEGIN (do not edit; managed by skillnote setup)'
const EXPECTED_END_MARKER = '# <<< SKILLNOTE WRAPPER END'

// The cleanup regex inside setup.py's WRAPCLEAN_EOF heredoc. Pinning it
// guards against future edits that accidentally weaken the pattern.
const EXPECTED_CLEANUP_REGEX_FRAGMENT = String.raw`# >>> SKILLNOTE WRAPPER BEGIN.*?# <<< SKILLNOTE WRAPPER END`

// Resolve setup.py from this file: cli/tests/unit/ → ../../../backend/...
const __dirname = dirname(fileURLToPath(import.meta.url))
const SETUP_PY = join(__dirname, '..', '..', '..', 'backend', 'app', 'api', 'setup.py')

describe('shell wrapper marker format (regression fence for setup.py)', () => {
  it('setup.py still emits the canonical BEGIN marker', async () => {
    const src = await readFile(SETUP_PY, 'utf8')
    expect(src).toContain(EXPECTED_BEGIN_MARKER)
  })

  it('setup.py still emits the canonical END marker', async () => {
    const src = await readFile(SETUP_PY, 'utf8')
    expect(src).toContain(EXPECTED_END_MARKER)
  })

  it('setup.py still uses the BEGIN/END pair in its cleanup regex', async () => {
    const src = await readFile(SETUP_PY, 'utf8')
    expect(src).toContain(EXPECTED_CLEANUP_REGEX_FRAGMENT)
  })

  it('setup.py emits both markers in matched BEGIN/END pairs (no orphan markers)', async () => {
    const src = await readFile(SETUP_PY, 'utf8')
    const begins = (src.match(/# >>> SKILLNOTE WRAPPER BEGIN/g) ?? []).length
    const ends = (src.match(/# <<< SKILLNOTE WRAPPER END/g) ?? []).length
    // Each "BEGIN" occurrence in setup.py corresponds to an "END" — the cleanup
    // regex, the bash heredoc, and the fish heredoc all use them in pairs.
    expect(begins).toBe(ends)
    expect(begins).toBeGreaterThanOrEqual(2) // cleanup regex + at least one shell branch
  })
})
