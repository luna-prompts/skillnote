import fs from 'node:fs'
import path from 'node:path'
import { detectAgents, getAdapter } from '../agents/index.js'
import { ApiClient } from '../api/client.js'
import { defaultConfigDir, loadConfig, resolveAuth } from '../config/index.js'
import { type ComposeOptions, ensureComposeExtracted } from '../docker/compose.js'
import { snapshot } from '../docker/health.js'
// v0.5: lifecycle-world checks. Imported lazily so the legacy doctor still
// works even when the new docker layer can't initialize.
import { composeVersion, isDockerRunning } from '../docker/inspect.js'
import { pkgInfo } from '../lib/package-info.js'
import { checkPorts } from '../lib/ports.js'
import { loadManifest } from '../manifest/index.js'
import * as ui from '../util/ui.js'

interface Check {
  label: string
  /**
   * 'core' (default): a failure is a real problem — counts toward the
   * "Some checks failed" tally.
   * 'legacy': only relevant for users coming from v0.4. A failure means
   * the v0.4 setup isn't present, which is expected on fresh v0.5 installs.
   * Rendered as informational; never flips the overall verdict.
   */
  scope?: 'core' | 'legacy'
  run: () => Promise<{ ok: boolean; detail: string }>
}

export async function doctorCommand(): Promise<void> {
  console.log(ui.bold('SkillNote Doctor'))
  console.log()

  const projectDir = process.cwd()
  const configDir = defaultConfigDir()
  const auth = resolveAuth(configDir)

  const checks: Check[] = [
    {
      label: 'Node.js version',
      run: async () => {
        const major = Number.parseInt(process.version.slice(1))
        return {
          ok: major >= 20,
          detail: `${process.version}${major < 20 ? ' (v0.5 requires >= 20)' : ''}`,
        }
      },
    },
    {
      label: 'v0.4 config file',
      scope: 'legacy',
      run: async () => {
        const config = loadConfig(configDir)
        return {
          ok: config !== null,
          detail: config ? `${configDir}/config.json` : 'not present (expected for v0.5+)',
        }
      },
    },
    {
      label: 'v0.4 config permissions',
      scope: 'legacy',
      run: async () => {
        const filePath = path.join(configDir, 'config.json')
        if (!fs.existsSync(filePath)) {
          return { ok: true, detail: 'skipped (no v0.4 config)' }
        }
        const stat = fs.statSync(filePath)
        const mode = (stat.mode & 0o777).toString(8)
        const safe = (stat.mode & 0o077) === 0
        return {
          ok: safe,
          detail: safe ? `${mode} (secure)` : `${mode} (should be 600 — run chmod 600 ${filePath})`,
        }
      },
    },
    {
      label: 'v0.4 backend reachable',
      scope: 'legacy',
      run: async () => {
        if (!auth) {
          return { ok: true, detail: 'skipped (no v0.4 config)' }
        }
        const client = new ApiClient(auth.host)
        const ok = await client.checkHealth()
        return { ok, detail: ok ? auth.host : `Cannot reach ${auth.host}` }
      },
    },
    {
      label: 'Agents detected',
      run: async () => {
        const agents = detectAgents(projectDir)
        return {
          ok: agents.length > 0,
          detail:
            agents.length > 0
              ? agents.map((a) => a.displayName).join(', ')
              : 'No agents detected in project',
        }
      },
    },
    {
      label: 'Installed skills: files exist',
      run: async () => {
        const manifest = loadManifest(projectDir)
        const slugs = Object.keys(manifest.skills)
        if (slugs.length === 0) return { ok: true, detail: 'No skills installed' }
        const missing: string[] = []
        for (const slug of slugs) {
          const entry = manifest.skills[slug]
          for (const agentName of entry.agents) {
            const adapter = getAdapter(agentName, projectDir)
            if (!adapter) continue
            const dir = adapter.skillDir(slug)
            if (!fs.existsSync(dir)) {
              missing.push(`${slug} (${agentName})`)
            }
          }
        }
        return {
          ok: missing.length === 0,
          detail:
            missing.length === 0
              ? `${slugs.length} skill(s) verified`
              : `Missing: ${missing.join(', ')}`,
        }
      },
    },
    {
      label: 'Disk space',
      run: async () => {
        try {
          const stat = fs.statfsSync(projectDir)
          const freeGB = (stat.bavail * stat.bsize) / (1024 * 1024 * 1024)
          return {
            ok: freeGB > 0.5,
            detail: `${freeGB.toFixed(1)} GB free`,
          }
        } catch {
          return { ok: true, detail: 'Could not check' }
        }
      },
    },
    // ─── v0.5 lifecycle checks ───────────────────────────────────────────
    {
      label: 'Docker daemon',
      run: async () => {
        const result = await isDockerRunning()
        return {
          ok: result.ok,
          detail: result.ok
            ? `running (${result.version ?? 'unknown version'})`
            : (result.error ?? 'not reachable'),
        }
      },
    },
    {
      label: 'docker compose v2',
      run: async () => {
        const v = await composeVersion()
        return {
          ok: v !== null,
          detail: v ?? 'not found (install via Docker Desktop or compose plugin)',
        }
      },
    },
    {
      label: 'Required ports (3000, 8082)',
      run: async () => {
        // Free is OK; in-use is also OK if SkillNote is the one using them.
        const ports = await checkPorts([
          { service: 'web', port: 3000 },
          { service: 'api', port: 8082 },
        ])
        const busy = ports.filter((p) => !p.free)
        if (busy.length === 0) {
          return { ok: true, detail: 'both ports free' }
        }
        // We can't easily tell if SkillNote owns the busy port without
        // matching container labels. Report as informational.
        return {
          ok: true,
          detail: `in use: ${busy.map((p) => p.port).join(', ')} (SkillNote may already be running)`,
        }
      },
    },
    {
      label: 'SkillNote services',
      run: async () => {
        try {
          const docker = await isDockerRunning()
          if (!docker.ok) return { ok: false, detail: 'Docker not running' }
          const composeFile = await ensureComposeExtracted(pkgInfo.version)
          const composeOpts: ComposeOptions = { composeFile }
          const services = await snapshot(composeOpts)
          const running = services.filter((s) => s.state === 'running')
          if (services.length === 0) {
            return { ok: true, detail: 'stopped (run `skillnote start` to launch)' }
          }
          const healthy = services.filter(
            (s) => s.health === 'healthy' || (s.state === 'running' && s.health === 'unknown'),
          )
          return {
            ok: healthy.length === services.length,
            detail: `${healthy.length}/${services.length} healthy · running: ${running
              .map((s) => s.service)
              .join(', ')}`,
          }
        } catch {
          return { ok: true, detail: 'no compose project active' }
        }
      },
    },
  ]

  let coreOk = true
  let legacyHadFailure = false
  for (const check of checks) {
    const result = await check.run()
    const isLegacy = check.scope === 'legacy'
    if (result.ok) {
      ui.success(`${check.label}: ${ui.dim(result.detail)}`)
    } else if (isLegacy) {
      // Legacy v0.4 checks failing on a v0.5 install is normal — surface
      // as informational, don't count toward the overall verdict.
      ui.warn(`${check.label}: ${result.detail}`)
      legacyHadFailure = true
    } else {
      ui.fail(`${check.label}: ${result.detail}`)
      coreOk = false
    }
  }

  console.log()
  if (coreOk) {
    ui.success(
      legacyHadFailure ? 'All core checks passed (legacy v0.4 items skipped)' : 'All checks passed',
    )
  } else {
    ui.warn('Some checks failed — see above')
  }
}
