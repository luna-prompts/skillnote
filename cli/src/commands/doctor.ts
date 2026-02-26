import fs from 'node:fs'
import path from 'node:path'
import { ApiClient } from '../api/client.js'
import { defaultConfigDir, loadConfig, resolveAuth } from '../config/index.js'
import { loadManifest } from '../manifest/index.js'
import { detectAgents, getAdapter } from '../agents/index.js'
import * as ui from '../util/ui.js'

interface Check {
  label: string
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
        const major = parseInt(process.version.slice(1))
        return {
          ok: major >= 18,
          detail: `${process.version}${major < 18 ? ' (requires >= 18)' : ''}`,
        }
      },
    },
    {
      label: 'Config file exists',
      run: async () => {
        const config = loadConfig(configDir)
        return {
          ok: config !== null,
          detail: config ? `${configDir}/config.json` : 'Not found. Run skillnote login',
        }
      },
    },
    {
      label: 'Config file permissions',
      run: async () => {
        const filePath = path.join(configDir, 'config.json')
        if (!fs.existsSync(filePath)) return { ok: false, detail: 'Config not found' }
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
      label: 'Backend reachable',
      run: async () => {
        if (!auth) return { ok: false, detail: 'No config — cannot check' }
        const client = new ApiClient(auth.host, auth.token)
        const ok = await client.checkHealth()
        return { ok, detail: ok ? auth.host : `Cannot reach ${auth.host}` }
      },
    },
    {
      label: 'Token valid',
      run: async () => {
        if (!auth) return { ok: false, detail: 'No config — cannot check' }
        const client = new ApiClient(auth.host, auth.token)
        const result = await client.validateToken()
        return {
          ok: result.valid,
          detail: result.valid
            ? `${result.subject?.type} (${result.subject?.id})`
            : 'Token invalid or expired',
        }
      },
    },
    {
      label: 'Agents detected',
      run: async () => {
        const agents = detectAgents(projectDir)
        return {
          ok: agents.length > 0,
          detail: agents.length > 0
            ? agents.map(a => a.displayName).join(', ')
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
          detail: missing.length === 0
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
  ]

  let allOk = true
  for (const check of checks) {
    const result = await check.run()
    if (result.ok) {
      ui.success(`${check.label}: ${ui.dim(result.detail)}`)
    } else {
      ui.fail(`${check.label}: ${result.detail}`)
      allOk = false
    }
  }

  console.log()
  if (allOk) {
    ui.success('All checks passed')
  } else {
    ui.warn('Some checks failed — see above')
  }
}
