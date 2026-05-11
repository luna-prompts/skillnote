/**
 * Hard case #19 — Web UI accessed from LAN.
 *
 * For a SkillNote box to be reachable from another machine on the same LAN
 * (the bring-your-own-laptop, share-a-team-instance use case), two things
 * MUST be true in the bundled docker-compose template:
 *
 *  1. The Web service binds to all interfaces (no `127.0.0.1:` prefix in the
 *     ports mapping). Docker's default port mapping form `"3000:3000"` binds
 *     to 0.0.0.0 — adding an explicit interface prefix would break LAN.
 *
 *  2. SKILLNOTE_CORS_ORIGINS includes the configurable host (`SKILLNOTE_HOST`),
 *     not just localhost — otherwise the API rejects browser requests from
 *     `http://<lan-ip>:3000`.
 *
 * This is a pure grep test over the .tpl file. Any future change that adds
 * a `127.0.0.1` binding or drops the SKILLNOTE_HOST CORS origin will fail
 * here.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TPL = join(__dirname, '..', '..', 'assets', 'docker-compose.yml.tpl')

describe('docker-compose.yml.tpl — LAN-accessibility invariants', () => {
  it('Web port mapping does not pin to 127.0.0.1', async () => {
    const src = await readFile(TPL, 'utf8')
    // Find the `web:` service block and inspect its ports lines.
    const webSection = src.split(/^\s*web:/m)[1] ?? ''
    expect(webSection, 'web service block').toBeTruthy()
    // ports: lines under `web:` must not contain a 127.0.0.1 prefix.
    const portsLine = (webSection.match(/^\s*-\s*"[^"]+:\d+"$/m) ?? [])[0] ?? ''
    expect(portsLine).toBeTruthy()
    expect(portsLine).not.toMatch(/127\.0\.0\.1/)
    expect(portsLine).not.toMatch(/localhost/i)
  })

  it('API port mapping does not pin to 127.0.0.1 either', async () => {
    const src = await readFile(TPL, 'utf8')
    const apiSection = src.split(/^\s*api:/m)[1]?.split(/^\s*web:/m)[0] ?? ''
    expect(apiSection, 'api service block').toBeTruthy()
    const portsLine = (apiSection.match(/^\s*-\s*"[^"]+:\d+"$/m) ?? [])[0] ?? ''
    expect(portsLine).toBeTruthy()
    expect(portsLine).not.toMatch(/127\.0\.0\.1/)
  })

  it('SKILLNOTE_CORS_ORIGINS includes the configurable SKILLNOTE_HOST', async () => {
    const src = await readFile(TPL, 'utf8')
    // Grep for any CORS_ORIGINS line that references the configurable host.
    expect(src).toMatch(/SKILLNOTE_CORS_ORIGINS/)
    const corsLine = src.split('\n').find((l) => l.includes('SKILLNOTE_CORS_ORIGINS')) ?? ''
    expect(corsLine, 'CORS line should include the configurable SKILLNOTE_HOST').toMatch(
      /\$\{SKILLNOTE_HOST/,
    )
    // And localhost still has a fallback (defensive: never lock out localhost).
    expect(corsLine).toMatch(/localhost/i)
  })

  it('Web service NEXT_PUBLIC_API_BASE_URL is configurable via SKILLNOTE_HOST too', async () => {
    const src = await readFile(TPL, 'utf8')
    const webSection = src.split(/^\s*web:/m)[1] ?? ''
    expect(webSection).toMatch(/NEXT_PUBLIC_API_BASE_URL/)
    expect(webSection).toMatch(/\$\{SKILLNOTE_HOST/)
  })
})
