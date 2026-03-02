# SkillNote CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an NPX CLI (`npx skillnote`) that authenticates against a self-hosted SkillNote registry and installs/updates skill bundles into local agent directories.

**Architecture:** Single TypeScript package in `cli/` compiled via tsup to one ESM bundle. Commands use `commander`, agent adapters are internal modules implementing a shared interface. Global config at `~/.skillnote/config.json`, per-project manifest at `.skillnote/manifest.json`.

**Tech Stack:** TypeScript 5, Node.js 18+, commander (CLI), chalk (colors), ora (spinners), tsup (build), vitest (tests)

---

### Task 1: Project Scaffolding

**Files:**
- Create: `cli/package.json`
- Create: `cli/tsconfig.json`
- Create: `cli/tsup.config.ts`
- Create: `cli/vitest.config.ts`
- Create: `cli/src/index.ts`

**Step 1: Create `cli/package.json`**

```json
{
  "name": "skillnote",
  "version": "0.1.0",
  "description": "CLI for the SkillNote skills registry",
  "type": "module",
  "bin": {
    "skillnote": "./dist/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "chalk": "^5.3.0",
    "ora": "^8.0.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  }
}
```

**Step 2: Create `cli/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

**Step 3: Create `cli/tsup.config.ts`**

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  dts: false,
  banner: { js: '#!/usr/bin/env node' },
})
```

**Step 4: Create `cli/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    root: '.',
  },
})
```

**Step 5: Create minimal `cli/src/index.ts`**

```typescript
import { Command } from 'commander'

const program = new Command()

program
  .name('skillnote')
  .description('CLI for the SkillNote skills registry')
  .version('0.1.0')

program.parse()
```

**Step 6: Install dependencies and verify build**

Run:
```bash
cd cli && npm install && npm run build
```
Expected: `dist/index.js` created with shebang, no errors.

**Step 7: Verify the CLI runs**

Run:
```bash
node dist/index.js --version
```
Expected: `0.1.0`

**Step 8: Commit**

```bash
git add cli/
git commit -m "feat(cli): scaffold project with tsup, vitest, commander"
```

---

### Task 2: Config Module

**Files:**
- Create: `cli/src/config/index.ts`
- Create: `cli/src/__tests__/config.test.ts`

**Step 1: Write the failing test**

```typescript
// cli/src/__tests__/config.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// We'll mock os.homedir to use a temp dir
let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillnote-test-'))
  vi.stubEnv('SKILLNOTE_CONFIG_DIR', path.join(tmpDir, '.skillnote'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('config', () => {
  it('returns null when no config exists', async () => {
    const { loadConfig } = await import('../config/index.js')
    const cfg = loadConfig(path.join(tmpDir, '.skillnote'))
    expect(cfg).toBeNull()
  })

  it('saves and loads config', async () => {
    const { saveConfig, loadConfig } = await import('../config/index.js')
    const configDir = path.join(tmpDir, '.skillnote')
    saveConfig(configDir, { host: 'https://example.com', token: 'skn_test_123' })
    const cfg = loadConfig(configDir)
    expect(cfg).toEqual({ host: 'https://example.com', token: 'skn_test_123' })
  })

  it('resolves env vars over config file', async () => {
    const { resolveAuth } = await import('../config/index.js')
    vi.stubEnv('SKILLNOTE_HOST', 'https://env.example.com')
    vi.stubEnv('SKILLNOTE_TOKEN', 'skn_env_456')
    const auth = resolveAuth(path.join(tmpDir, '.skillnote'))
    expect(auth).toEqual({ host: 'https://env.example.com', token: 'skn_env_456' })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd cli && npx vitest run src/__tests__/config.test.ts`
Expected: FAIL — module `../config/index.js` does not exist

**Step 3: Write the implementation**

```typescript
// cli/src/config/index.ts
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface Config {
  host: string
  token: string
}

export function defaultConfigDir(): string {
  return path.join(os.homedir(), '.skillnote')
}

export function loadConfig(configDir: string): Config | null {
  const filePath = path.join(configDir, 'config.json')
  if (!fs.existsSync(filePath)) return null
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    if (typeof data.host === 'string' && typeof data.token === 'string') {
      return { host: data.host, token: data.token }
    }
    return null
  } catch {
    return null
  }
}

export function saveConfig(configDir: string, config: Config): void {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 })
  const filePath = path.join(configDir, 'config.json')
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
}

export function resolveAuth(configDir: string): Config | null {
  const envHost = process.env.SKILLNOTE_HOST
  const envToken = process.env.SKILLNOTE_TOKEN
  if (envHost && envToken) {
    return { host: envHost, token: envToken }
  }
  return loadConfig(configDir)
}
```

**Step 4: Run test to verify it passes**

Run: `cd cli && npx vitest run src/__tests__/config.test.ts`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add cli/src/config/ cli/src/__tests__/config.test.ts
git commit -m "feat(cli): add config module with env var override"
```

---

### Task 3: API Client

**Files:**
- Create: `cli/src/api/client.ts`
- Create: `cli/src/__tests__/api-client.test.ts`

**Step 1: Write the failing test**

```typescript
// cli/src/__tests__/api-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('ApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('adds auth header to requests', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { ApiClient } = await import('../api/client.js')
    const client = new ApiClient('https://example.com', 'skn_test_123')
    await client.get('/health')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/health',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer skn_test_123',
        }),
      })
    )
  })

  it('throws on non-ok response with error body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: { code: 'SKILL_NOT_FOUND', message: 'Skill not found' } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { ApiClient } = await import('../api/client.js')
    const client = new ApiClient('https://example.com', 'skn_test_123')
    await expect(client.get('/v1/skills/nope')).rejects.toThrow('Skill not found')
  })

  it('validates token via POST', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ valid: true, subject: { type: 'user', id: 'me' } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { ApiClient } = await import('../api/client.js')
    const client = new ApiClient('https://example.com', 'skn_test_123')
    const result = await client.validateToken()
    expect(result).toEqual({ valid: true, subject: { type: 'user', id: 'me' } })
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/auth/validate-token',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd cli && npx vitest run src/__tests__/api-client.test.ts`
Expected: FAIL — cannot import `../api/client.js`

**Step 3: Write the implementation**

```typescript
// cli/src/api/client.ts

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ValidateTokenResult {
  valid: boolean
  subject?: { type: string; id: string }
  expiresAt?: string
}

export interface SkillListItem {
  name: string
  slug: string
  description: string
  tags: string[]
  collections: string[]
  latestVersion: string | null
  status: string | null
  channel: string | null
}

export interface SkillVersionItem {
  version: string
  checksumSha256: string
  status: string
  channel: string
  publishedAt: string
  releaseNotes: string | null
}

export class ApiClient {
  private baseUrl: string
  private token: string

  constructor(host: string, token: string) {
    this.baseUrl = host.replace(/\/+$/, '')
    this.token = token
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' })
  }

  async validateToken(): Promise<ValidateTokenResult> {
    const res = await fetch(`${this.baseUrl}/auth/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: this.token }),
    })
    return res.json() as Promise<ValidateTokenResult>
  }

  async downloadBundle(
    skill: string,
    version: string,
  ): Promise<{ buffer: Buffer; checksum: string }> {
    const res = await fetch(`${this.baseUrl}/v1/skills/${skill}/${version}/download`, {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: { code: 'UNKNOWN', message: res.statusText } }))
      throw new ApiError(res.status, body.error?.code ?? 'UNKNOWN', body.error?.message ?? res.statusText)
    }
    const checksum = res.headers.get('X-Checksum-Sha256') ?? ''
    const arrayBuf = await res.arrayBuffer()
    return { buffer: Buffer.from(arrayBuf), checksum }
  }

  async listSkills(): Promise<SkillListItem[]> {
    return this.get<SkillListItem[]>('/v1/skills')
  }

  async listVersions(skill: string): Promise<SkillVersionItem[]> {
    return this.get<SkillVersionItem[]>(`/v1/skills/${skill}/versions`)
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`)
      return res.ok
    } catch {
      return false
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers as Record<string, string>,
        Authorization: `Bearer ${this.token}`,
      },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: { code: 'UNKNOWN', message: res.statusText } }))
      throw new ApiError(res.status, body.error?.code ?? 'UNKNOWN', body.error?.message ?? res.statusText)
    }
    return res.json() as Promise<T>
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd cli && npx vitest run src/__tests__/api-client.test.ts`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add cli/src/api/ cli/src/__tests__/api-client.test.ts
git commit -m "feat(cli): add API client with auth, download, list, versions"
```

---

### Task 4: UI Utilities

**Files:**
- Create: `cli/src/util/ui.ts`

**Step 1: Write the implementation**

```typescript
// cli/src/util/ui.ts
import chalk from 'chalk'
import ora, { type Ora } from 'ora'

export function success(msg: string): void {
  console.log(chalk.green('✓') + ' ' + msg)
}

export function fail(msg: string): void {
  console.log(chalk.red('✗') + ' ' + msg)
}

export function warn(msg: string): void {
  console.log(chalk.yellow('⚠') + ' ' + msg)
}

export function info(msg: string): void {
  console.log(chalk.cyan('ℹ') + ' ' + msg)
}

export function dim(msg: string): string {
  return chalk.dim(msg)
}

export function bold(msg: string): string {
  return chalk.bold(msg)
}

export function spinner(text: string): Ora {
  return ora({ text, color: 'cyan' })
}

export function table(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
  )
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length))
  console.log(headers.map((h, i) => chalk.dim(pad(h, widths[i]))).join('  '))
  for (const row of rows) {
    console.log(row.map((c, i) => pad(c, widths[i])).join('  '))
  }
}
```

**Step 2: Verify build still works**

Run: `cd cli && npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add cli/src/util/ui.ts
git commit -m "feat(cli): add UI utilities (chalk, ora wrappers)"
```

---

### Task 5: Checksum & ZIP Utilities

**Files:**
- Create: `cli/src/util/checksum.ts`
- Create: `cli/src/util/zip.ts`
- Create: `cli/src/__tests__/checksum.test.ts`
- Create: `cli/src/__tests__/zip.test.ts`

**Step 1: Write the checksum failing test**

```typescript
// cli/src/__tests__/checksum.test.ts
import { describe, it, expect } from 'vitest'
import { computeSha256 } from '../util/checksum.js'

describe('computeSha256', () => {
  it('computes correct hash of a buffer', () => {
    const buf = Buffer.from('hello world')
    const hash = computeSha256(buf)
    // known SHA-256 of "hello world"
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd cli && npx vitest run src/__tests__/checksum.test.ts`
Expected: FAIL — cannot import

**Step 3: Write checksum implementation**

```typescript
// cli/src/util/checksum.ts
import { createHash } from 'node:crypto'

export function computeSha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}
```

**Step 4: Run test to verify it passes**

Run: `cd cli && npx vitest run src/__tests__/checksum.test.ts`
Expected: PASS

**Step 5: Write the ZIP failing test**

```typescript
// cli/src/__tests__/zip.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { extractZipSafe } from '../util/zip.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('extractZipSafe', () => {
  it('extracts a valid zip', () => {
    // Create a test zip with a file inside
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

  it('rejects zip with path traversal', () => {
    // We test the validation logic by passing a buffer with a crafted entry
    // The real test is that extractZipSafe validates each entry name
    // For simplicity, we test the entry validation function directly
    const { validateEntryName } = require('../util/zip.js')
    expect(() => validateEntryName('../etc/passwd')).toThrow('traversal')
    expect(() => validateEntryName('/absolute/path')).toThrow('absolute')
  })
})
```

**Step 6: Run test to verify it fails**

Run: `cd cli && npx vitest run src/__tests__/zip.test.ts`
Expected: FAIL — cannot import

**Step 7: Write ZIP implementation**

```typescript
// cli/src/util/zip.ts
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
  // Write buffer to a temp file
  const tmpZip = path.join(os.tmpdir(), `skillnote-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`)
  try {
    fs.writeFileSync(tmpZip, zipBuffer)

    // List entries and validate before extracting
    const listOutput = execSync(`unzip -l "${tmpZip}"`, { encoding: 'utf-8' })
    const lines = listOutput.split('\n')
    for (const line of lines) {
      // unzip -l format: "  Length      Date    Time    Name"
      // entries appear after the header line with dashes
      const match = /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/.exec(line)
      if (match) {
        validateEntryName(match[1].trim())
      }
    }

    // Extract
    fs.mkdirSync(destDir, { recursive: true })
    execSync(`unzip -o "${tmpZip}" -d "${destDir}"`, { stdio: 'pipe' })
  } finally {
    fs.rmSync(tmpZip, { force: true })
  }
}
```

**Step 8: Run test to verify it passes**

Run: `cd cli && npx vitest run src/__tests__/zip.test.ts`
Expected: 2 tests PASS

**Step 9: Commit**

```bash
git add cli/src/util/checksum.ts cli/src/util/zip.ts cli/src/__tests__/checksum.test.ts cli/src/__tests__/zip.test.ts
git commit -m "feat(cli): add SHA-256 checksum and safe ZIP extraction utils"
```

---

### Task 6: Manifest Module

**Files:**
- Create: `cli/src/manifest/index.ts`
- Create: `cli/src/__tests__/manifest.test.ts`

**Step 1: Write the failing test**

```typescript
// cli/src/__tests__/manifest.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('manifest', () => {
  it('returns empty manifest when none exists', async () => {
    const { loadManifest } = await import('../manifest/index.js')
    const m = loadManifest(tmpDir)
    expect(m.skills).toEqual({})
  })

  it('saves and loads a skill entry', async () => {
    const { loadManifest, saveManifest } = await import('../manifest/index.js')
    const manifest = loadManifest(tmpDir)
    manifest.skills['secure-migrations'] = {
      version: '0.1.0',
      checksum: 'abc123',
      installedAt: '2026-02-26T00:00:00Z',
      agents: ['claude', 'openclaw'],
    }
    saveManifest(tmpDir, manifest)

    const loaded = loadManifest(tmpDir)
    expect(loaded.skills['secure-migrations'].version).toBe('0.1.0')
    expect(loaded.skills['secure-migrations'].agents).toEqual(['claude', 'openclaw'])
  })

  it('removes a skill entry', async () => {
    const { loadManifest, saveManifest } = await import('../manifest/index.js')
    const manifest = loadManifest(tmpDir)
    manifest.skills['test-skill'] = {
      version: '1.0.0',
      checksum: 'def456',
      installedAt: '2026-02-26T00:00:00Z',
      agents: ['cursor'],
    }
    saveManifest(tmpDir, manifest)
    delete manifest.skills['test-skill']
    saveManifest(tmpDir, manifest)

    const loaded = loadManifest(tmpDir)
    expect(loaded.skills['test-skill']).toBeUndefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd cli && npx vitest run src/__tests__/manifest.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// cli/src/manifest/index.ts
import fs from 'node:fs'
import path from 'node:path'

export interface SkillEntry {
  version: string
  checksum: string
  installedAt: string
  agents: string[]
}

export interface Manifest {
  skills: Record<string, SkillEntry>
}

const MANIFEST_FILE = '.skillnote/manifest.json'

export function loadManifest(projectDir: string): Manifest {
  const filePath = path.join(projectDir, MANIFEST_FILE)
  if (!fs.existsSync(filePath)) {
    return { skills: {} }
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as Manifest
  } catch {
    return { skills: {} }
  }
}

export function saveManifest(projectDir: string, manifest: Manifest): void {
  const dir = path.join(projectDir, '.skillnote')
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, 'manifest.json')
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n')
}
```

**Step 4: Run test to verify it passes**

Run: `cd cli && npx vitest run src/__tests__/manifest.test.ts`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add cli/src/manifest/ cli/src/__tests__/manifest.test.ts
git commit -m "feat(cli): add manifest module for tracking installed skills"
```

---

### Task 7: Agent Adapter Interface + All Adapters

**Files:**
- Create: `cli/src/agents/types.ts`
- Create: `cli/src/agents/claude.ts`
- Create: `cli/src/agents/cursor.ts`
- Create: `cli/src/agents/codex.ts`
- Create: `cli/src/agents/openclaw.ts`
- Create: `cli/src/agents/openhands.ts`
- Create: `cli/src/agents/universal.ts`
- Create: `cli/src/agents/index.ts`
- Create: `cli/src/__tests__/agents.test.ts`

**Step 1: Write the failing test**

```typescript
// cli/src/__tests__/agents.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('agent adapters', () => {
  it('detects Claude Code when .claude/ exists', async () => {
    const { ClaudeAdapter } = await import('../agents/claude.js')
    const adapter = new ClaudeAdapter(tmpDir)
    expect(adapter.detect()).toBe(false)

    fs.mkdirSync(path.join(tmpDir, '.claude'))
    expect(adapter.detect()).toBe(true)
  })

  it('returns correct skill dir for Claude', async () => {
    const { ClaudeAdapter } = await import('../agents/claude.js')
    const adapter = new ClaudeAdapter(tmpDir)
    expect(adapter.skillDir('my-skill')).toBe(path.join(tmpDir, '.claude', 'skills', 'my-skill'))
  })

  it('detects OpenClaw when ~/.openclaw/ exists', async () => {
    const { OpenClawAdapter } = await import('../agents/openclaw.js')
    const fakeHome = path.join(tmpDir, 'fakehome')
    fs.mkdirSync(fakeHome)
    const adapter = new OpenClawAdapter(tmpDir, fakeHome)
    expect(adapter.detect()).toBe(false)

    fs.mkdirSync(path.join(fakeHome, '.openclaw'))
    expect(adapter.detect()).toBe(true)
  })

  it('installs OpenClaw skills to workspace skills/ dir', async () => {
    const { OpenClawAdapter } = await import('../agents/openclaw.js')
    const adapter = new OpenClawAdapter(tmpDir, tmpDir)
    expect(adapter.skillDir('my-skill')).toBe(path.join(tmpDir, 'skills', 'my-skill'))
  })

  it('detectAll returns only detected agents', async () => {
    const { detectAgents } = await import('../agents/index.js')
    fs.mkdirSync(path.join(tmpDir, '.claude'))
    const detected = detectAgents(tmpDir, tmpDir)
    const names = detected.map(a => a.name)
    expect(names).toContain('claude')
    expect(names).not.toContain('cursor')
    // universal is always present
    expect(names).toContain('universal')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd cli && npx vitest run src/__tests__/agents.test.ts`
Expected: FAIL

**Step 3: Write the types**

```typescript
// cli/src/agents/types.ts
export interface AgentAdapter {
  name: string
  displayName: string
  detect(): boolean
  skillDir(skillSlug: string): string
  postInstall?(skillSlug: string): void
}
```

**Step 4: Write Claude adapter**

```typescript
// cli/src/agents/claude.ts
import fs from 'node:fs'
import path from 'node:path'
import type { AgentAdapter } from './types.js'

export class ClaudeAdapter implements AgentAdapter {
  name = 'claude'
  displayName = 'Claude Code'

  constructor(private projectDir: string) {}

  detect(): boolean {
    return fs.existsSync(path.join(this.projectDir, '.claude'))
  }

  skillDir(slug: string): string {
    return path.join(this.projectDir, '.claude', 'skills', slug)
  }
}
```

**Step 5: Write Cursor adapter**

```typescript
// cli/src/agents/cursor.ts
import fs from 'node:fs'
import path from 'node:path'
import type { AgentAdapter } from './types.js'

export class CursorAdapter implements AgentAdapter {
  name = 'cursor'
  displayName = 'Cursor'

  constructor(private projectDir: string) {}

  detect(): boolean {
    return (
      fs.existsSync(path.join(this.projectDir, '.cursor')) ||
      fs.existsSync(path.join(this.projectDir, '.cursorrules'))
    )
  }

  skillDir(slug: string): string {
    return path.join(this.projectDir, '.cursor', 'skills', slug)
  }
}
```

**Step 6: Write Codex adapter**

```typescript
// cli/src/agents/codex.ts
import fs from 'node:fs'
import path from 'node:path'
import type { AgentAdapter } from './types.js'

export class CodexAdapter implements AgentAdapter {
  name = 'codex'
  displayName = 'Codex'

  constructor(private projectDir: string) {}

  detect(): boolean {
    return fs.existsSync(path.join(this.projectDir, '.codex'))
  }

  skillDir(slug: string): string {
    return path.join(this.projectDir, '.codex', 'skills', slug)
  }
}
```

**Step 7: Write OpenClaw adapter**

```typescript
// cli/src/agents/openclaw.ts
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { AgentAdapter } from './types.js'

export class OpenClawAdapter implements AgentAdapter {
  name = 'openclaw'
  displayName = 'OpenClaw'

  constructor(
    private projectDir: string,
    private homeDir: string = os.homedir(),
  ) {}

  detect(): boolean {
    return fs.existsSync(path.join(this.homeDir, '.openclaw'))
  }

  skillDir(slug: string): string {
    return path.join(this.projectDir, 'skills', slug)
  }
}
```

**Step 8: Write OpenHands adapter**

```typescript
// cli/src/agents/openhands.ts
import fs from 'node:fs'
import path from 'node:path'
import type { AgentAdapter } from './types.js'

export class OpenHandsAdapter implements AgentAdapter {
  name = 'openhands'
  displayName = 'OpenHands'

  constructor(private projectDir: string) {}

  detect(): boolean {
    return fs.existsSync(path.join(this.projectDir, '.openhands'))
  }

  skillDir(slug: string): string {
    return path.join(this.projectDir, '.openhands', 'skills', slug)
  }
}
```

**Step 9: Write Universal adapter**

```typescript
// cli/src/agents/universal.ts
import path from 'node:path'
import type { AgentAdapter } from './types.js'

export class UniversalAdapter implements AgentAdapter {
  name = 'universal'
  displayName = 'Universal (.agents/skills/)'

  constructor(private projectDir: string) {}

  detect(): boolean {
    return true // always available as fallback
  }

  skillDir(slug: string): string {
    return path.join(this.projectDir, '.agents', 'skills', slug)
  }
}
```

**Step 10: Write the index (detectAgents + getAdapter)**

```typescript
// cli/src/agents/index.ts
import os from 'node:os'
import type { AgentAdapter } from './types.js'
import { ClaudeAdapter } from './claude.js'
import { CursorAdapter } from './cursor.js'
import { CodexAdapter } from './codex.js'
import { OpenClawAdapter } from './openclaw.js'
import { OpenHandsAdapter } from './openhands.js'
import { UniversalAdapter } from './universal.js'

export type { AgentAdapter }

export function allAdapters(projectDir: string, homeDir?: string): AgentAdapter[] {
  const home = homeDir ?? os.homedir()
  return [
    new ClaudeAdapter(projectDir),
    new CursorAdapter(projectDir),
    new CodexAdapter(projectDir),
    new OpenClawAdapter(projectDir, home),
    new OpenHandsAdapter(projectDir),
    new UniversalAdapter(projectDir),
  ]
}

export function detectAgents(projectDir: string, homeDir?: string): AgentAdapter[] {
  return allAdapters(projectDir, homeDir).filter(a => a.detect())
}

export function getAdapter(name: string, projectDir: string, homeDir?: string): AgentAdapter | undefined {
  return allAdapters(projectDir, homeDir).find(a => a.name === name)
}
```

**Step 11: Run tests to verify they pass**

Run: `cd cli && npx vitest run src/__tests__/agents.test.ts`
Expected: 5 tests PASS

**Step 12: Commit**

```bash
git add cli/src/agents/ cli/src/__tests__/agents.test.ts
git commit -m "feat(cli): add agent adapters for Claude, Cursor, Codex, OpenClaw, OpenHands, Universal"
```

---

### Task 8: Login Command

**Files:**
- Create: `cli/src/commands/login.ts`
- Modify: `cli/src/index.ts`

**Step 1: Write the implementation**

```typescript
// cli/src/commands/login.ts
import { createInterface } from 'node:readline'
import { ApiClient } from '../api/client.js'
import { defaultConfigDir, saveConfig } from '../config/index.js'
import * as ui from '../util/ui.js'

async function readLineHidden(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    // For masked input, we use a simple approach
    process.stdout.write(prompt)
    let input = ''
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf-8')
    const onData = (ch: string) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        process.stdin.setRawMode?.(false)
        process.stdin.removeListener('data', onData)
        process.stdout.write('\n')
        rl.close()
        resolve(input)
      } else if (ch === '\u0003') {
        process.exit(1)
      } else if (ch === '\u007f' || ch === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1)
          process.stdout.write('\b \b')
        }
      } else {
        input += ch
        process.stdout.write('*')
      }
    }
    process.stdin.on('data', onData)
  })
}

async function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

export async function loginCommand(options: { host?: string; token?: string }): Promise<void> {
  const host = options.host ?? (await readLine('Host URL: '))
  if (!host) {
    ui.fail('Host URL is required')
    process.exit(1)
  }

  const token = options.token ?? (await readLineHidden('Token: '))
  if (!token) {
    ui.fail('Token is required')
    process.exit(1)
  }

  const spin = ui.spinner('Validating token...')
  spin.start()

  const client = new ApiClient(host.replace(/\/+$/, ''), token)
  const result = await client.validateToken()

  if (!result.valid) {
    spin.stop()
    ui.fail('Token is invalid or expired')
    process.exit(1)
  }

  const configDir = defaultConfigDir()
  saveConfig(configDir, { host: host.replace(/\/+$/, ''), token })
  spin.stop()

  const subject = result.subject
  ui.success(`Logged in to ${ui.bold(host)} as ${subject?.type ?? 'user'} (${subject?.id ?? 'unknown'})`)
}
```

**Step 2: Wire into `cli/src/index.ts`**

```typescript
// cli/src/index.ts
import { Command } from 'commander'
import { loginCommand } from './commands/login.js'

const program = new Command()

program
  .name('skillnote')
  .description('CLI for the SkillNote skills registry')
  .version('0.1.0')

program
  .command('login')
  .description('Authenticate with a SkillNote registry')
  .option('--host <url>', 'Registry URL')
  .option('--token <token>', 'Access token')
  .action(loginCommand)

program.parse()
```

**Step 3: Build and test manually**

Run: `cd cli && npm run build && node dist/index.js login --help`
Expected: Shows login command help with --host and --token options

**Step 4: Commit**

```bash
git add cli/src/commands/login.ts cli/src/index.ts
git commit -m "feat(cli): add login command with token validation"
```

---

### Task 9: List Command

**Files:**
- Create: `cli/src/commands/list.ts`
- Modify: `cli/src/index.ts`

**Step 1: Write the implementation**

```typescript
// cli/src/commands/list.ts
import { ApiClient } from '../api/client.js'
import { defaultConfigDir, resolveAuth } from '../config/index.js'
import { loadManifest } from '../manifest/index.js'
import * as ui from '../util/ui.js'

export async function listCommand(): Promise<void> {
  const auth = resolveAuth(defaultConfigDir())
  if (!auth) {
    ui.fail('Not logged in. Run ' + ui.bold('skillnote login') + ' first.')
    process.exit(1)
  }

  const spin = ui.spinner('Fetching skills...')
  spin.start()

  const client = new ApiClient(auth.host, auth.token)
  const skills = await client.listSkills()
  spin.stop()

  if (skills.length === 0) {
    ui.info('No skills available for this token.')
    return
  }

  const manifest = loadManifest(process.cwd())
  const rows = skills.map(s => {
    const installed = manifest.skills[s.slug]
    let status = 'available'
    if (installed) {
      status = installed.version === s.latestVersion ? 'installed' : 'outdated'
    }
    return [
      s.slug,
      s.latestVersion ?? '-',
      status,
      (s.tags ?? []).join(', ') || '-',
    ]
  })

  ui.table(['NAME', 'VERSION', 'STATUS', 'TAGS'], rows)
}
```

**Step 2: Add to `cli/src/index.ts`**

Add after login command registration:

```typescript
import { listCommand } from './commands/list.js'

// ...

program
  .command('list')
  .description('List skills available from the registry')
  .action(listCommand)
```

**Step 3: Build and verify**

Run: `cd cli && npm run build && node dist/index.js list --help`
Expected: Shows list command help

**Step 4: Commit**

```bash
git add cli/src/commands/list.ts cli/src/index.ts
git commit -m "feat(cli): add list command with install status"
```

---

### Task 10: Add Command

**Files:**
- Create: `cli/src/commands/add.ts`
- Modify: `cli/src/index.ts`

This is the most complex command — it downloads, verifies, extracts, and installs to agent directories.

**Step 1: Write the implementation**

```typescript
// cli/src/commands/add.ts
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ApiClient, type SkillVersionItem } from '../api/client.js'
import { defaultConfigDir, resolveAuth } from '../config/index.js'
import { loadManifest, saveManifest } from '../manifest/index.js'
import { detectAgents, getAdapter } from '../agents/index.js'
import { computeSha256 } from '../util/checksum.js'
import { extractZipSafe } from '../util/zip.js'
import * as ui from '../util/ui.js'

function pickLatestActive(versions: SkillVersionItem[]): SkillVersionItem | null {
  return versions.find(v => v.status === 'active') ?? null
}

async function installSkill(
  client: ApiClient,
  slug: string,
  agents: ReturnType<typeof detectAgents>,
  projectDir: string,
  yes: boolean,
): Promise<boolean> {
  // 1. Get latest version
  const spin = ui.spinner(`Fetching versions for ${ui.bold(slug)}...`)
  spin.start()

  let versions: SkillVersionItem[]
  try {
    versions = await client.listVersions(slug)
  } catch (err: any) {
    spin.stop()
    ui.fail(`${slug}: ${err.message}`)
    return false
  }

  const latest = pickLatestActive(versions)
  if (!latest) {
    spin.stop()
    ui.fail(`${slug}: no active version found`)
    return false
  }

  // 2. Download
  spin.text = `Downloading ${slug}@${latest.version}...`
  let buffer: Buffer
  let serverChecksum: string
  try {
    const dl = await client.downloadBundle(slug, latest.version)
    buffer = dl.buffer
    serverChecksum = dl.checksum
  } catch (err: any) {
    spin.stop()
    ui.fail(`${slug}: download failed — ${err.message}`)
    return false
  }

  // 3. Verify checksum
  spin.text = `Verifying checksum...`
  const localChecksum = computeSha256(buffer)
  if (serverChecksum && localChecksum !== serverChecksum) {
    spin.stop()
    ui.fail(`${slug}: checksum mismatch`)
    console.log(`  Expected: ${serverChecksum}`)
    console.log(`  Got:      ${localChecksum}`)
    return false
  }

  // 4. Extract to temp
  spin.text = `Extracting...`
  const tmpDir = path.join(os.tmpdir(), `skillnote-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  try {
    extractZipSafe(buffer, tmpDir)
  } catch (err: any) {
    spin.stop()
    ui.fail(`${slug}: extraction failed — ${err.message}`)
    return false
  }

  // 5. Install to each agent
  const agentNames: string[] = []
  for (const agent of agents) {
    const dest = agent.skillDir(slug)
    fs.mkdirSync(dest, { recursive: true })
    // Copy all files from tmpDir to dest
    copyDirSync(tmpDir, dest)
    agent.postInstall?.(slug)
    agentNames.push(agent.name)
  }

  // 6. Clean up temp
  fs.rmSync(tmpDir, { recursive: true, force: true })

  // 7. Update manifest
  const manifest = loadManifest(projectDir)
  manifest.skills[slug] = {
    version: latest.version,
    checksum: localChecksum,
    installedAt: new Date().toISOString(),
    agents: agentNames,
  }
  saveManifest(projectDir, manifest)

  spin.stop()
  ui.success(`${ui.bold(slug)}@${latest.version} installed to ${agentNames.join(', ')}`)
  return true
}

function copyDirSync(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true })
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

export async function addCommand(
  skill: string | undefined,
  options: { agent?: string; all?: boolean; yes?: boolean },
): Promise<void> {
  const auth = resolveAuth(defaultConfigDir())
  if (!auth) {
    ui.fail('Not logged in. Run ' + ui.bold('skillnote login') + ' first.')
    process.exit(1)
  }

  const projectDir = process.cwd()
  const client = new ApiClient(auth.host, auth.token)

  // Determine agents
  let agents = options.agent
    ? [getAdapter(options.agent, projectDir)].filter(Boolean) as ReturnType<typeof detectAgents>
    : detectAgents(projectDir)

  if (agents.length === 0) {
    ui.warn('No agents detected. Using Universal adapter (.agents/skills/)')
    const { UniversalAdapter } = await import('../agents/universal.js')
    agents = [new UniversalAdapter(projectDir)]
  }

  ui.info(`Target agents: ${agents.map(a => a.displayName).join(', ')}`)

  // Determine which skills to install
  let slugs: string[]
  if (options.all) {
    const spin = ui.spinner('Fetching skill list...')
    spin.start()
    const skills = await client.listSkills()
    spin.stop()
    slugs = skills.map(s => s.slug)
  } else if (skill) {
    slugs = [skill]
  } else {
    ui.fail('Specify a skill name or use --all')
    process.exit(1)
  }

  let succeeded = 0
  let failed = 0
  for (const slug of slugs) {
    const ok = await installSkill(client, slug, agents, projectDir, options.yes ?? false)
    if (ok) succeeded++
    else failed++
  }

  if (slugs.length > 1) {
    console.log()
    ui.info(`${succeeded} installed, ${failed} failed`)
  }
}
```

**Step 2: Add to `cli/src/index.ts`**

```typescript
import { addCommand } from './commands/add.js'

// ...

program
  .command('add [skill]')
  .description('Install a skill from the registry')
  .option('--agent <name>', 'Target specific agent (claude, cursor, codex, openclaw, openhands, universal)')
  .option('--all', 'Install all available skills')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(addCommand)
```

**Step 3: Build and verify**

Run: `cd cli && npm run build && node dist/index.js add --help`
Expected: Shows add command help

**Step 4: Commit**

```bash
git add cli/src/commands/add.ts cli/src/index.ts
git commit -m "feat(cli): add command with download, checksum verify, multi-agent install"
```

---

### Task 11: Check Command

**Files:**
- Create: `cli/src/commands/check.ts`
- Modify: `cli/src/index.ts`

**Step 1: Write the implementation**

```typescript
// cli/src/commands/check.ts
import { ApiClient } from '../api/client.js'
import { defaultConfigDir, resolveAuth } from '../config/index.js'
import { loadManifest } from '../manifest/index.js'
import * as ui from '../util/ui.js'

export async function checkCommand(): Promise<void> {
  const auth = resolveAuth(defaultConfigDir())
  if (!auth) {
    ui.fail('Not logged in. Run ' + ui.bold('skillnote login') + ' first.')
    process.exit(1)
  }

  const manifest = loadManifest(process.cwd())
  const slugs = Object.keys(manifest.skills)
  if (slugs.length === 0) {
    ui.info('No skills installed. Run ' + ui.bold('skillnote add <skill>') + ' to install one.')
    return
  }

  const client = new ApiClient(auth.host, auth.token)
  const spin = ui.spinner('Checking for updates...')
  spin.start()

  const rows: string[][] = []
  let updatesAvailable = 0

  for (const slug of slugs) {
    const installed = manifest.skills[slug]
    try {
      const versions = await client.listVersions(slug)
      const latest = versions.find(v => v.status === 'active')
      if (latest && latest.version !== installed.version) {
        rows.push([slug, `${installed.version} → ${latest.version}`, 'update available'])
        updatesAvailable++
      } else {
        rows.push([slug, installed.version, 'up to date'])
      }
    } catch {
      rows.push([slug, installed.version, 'error checking'])
    }
  }

  spin.stop()
  ui.table(['NAME', 'VERSION', 'STATUS'], rows)

  if (updatesAvailable > 0) {
    console.log()
    ui.info(`${updatesAvailable} update(s) available. Run ${ui.bold('skillnote update --all')} to update.`)
  }
}
```

**Step 2: Add to `cli/src/index.ts`**

```typescript
import { checkCommand } from './commands/check.js'

// ...

program
  .command('check')
  .description('Check installed skills for updates')
  .action(checkCommand)
```

**Step 3: Build and verify**

Run: `cd cli && npm run build && node dist/index.js check --help`
Expected: Shows check command help

**Step 4: Commit**

```bash
git add cli/src/commands/check.ts cli/src/index.ts
git commit -m "feat(cli): add check command for update detection"
```

---

### Task 12: Update Command

**Files:**
- Create: `cli/src/commands/update.ts`
- Modify: `cli/src/index.ts`

**Step 1: Write the implementation**

```typescript
// cli/src/commands/update.ts
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ApiClient, type SkillVersionItem } from '../api/client.js'
import { defaultConfigDir, resolveAuth } from '../config/index.js'
import { loadManifest, saveManifest } from '../manifest/index.js'
import { getAdapter, detectAgents } from '../agents/index.js'
import { computeSha256 } from '../util/checksum.js'
import { extractZipSafe } from '../util/zip.js'
import * as ui from '../util/ui.js'

function copyDirSync(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true })
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

export async function updateCommand(
  skill: string | undefined,
  options: { all?: boolean; yes?: boolean },
): Promise<void> {
  const auth = resolveAuth(defaultConfigDir())
  if (!auth) {
    ui.fail('Not logged in. Run ' + ui.bold('skillnote login') + ' first.')
    process.exit(1)
  }

  const projectDir = process.cwd()
  const manifest = loadManifest(projectDir)
  const client = new ApiClient(auth.host, auth.token)

  let slugs: string[]
  if (options.all) {
    slugs = Object.keys(manifest.skills)
  } else if (skill) {
    if (!manifest.skills[skill]) {
      ui.fail(`${skill} is not installed. Run ${ui.bold('skillnote add ' + skill)} first.`)
      process.exit(1)
    }
    slugs = [skill]
  } else {
    ui.fail('Specify a skill name or use --all')
    process.exit(1)
  }

  if (slugs.length === 0) {
    ui.info('No skills installed.')
    return
  }

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const slug of slugs) {
    const entry = manifest.skills[slug]
    const spin = ui.spinner(`Checking ${slug}...`)
    spin.start()

    let versions: SkillVersionItem[]
    try {
      versions = await client.listVersions(slug)
    } catch (err: any) {
      spin.stop()
      ui.fail(`${slug}: ${err.message}`)
      failed++
      continue
    }

    const latest = versions.find(v => v.status === 'active')
    if (!latest || latest.version === entry.version) {
      spin.stop()
      ui.info(`${slug} is up to date (${entry.version})`)
      skipped++
      continue
    }

    spin.text = `Downloading ${slug}@${latest.version}...`
    let buffer: Buffer
    let serverChecksum: string
    try {
      const dl = await client.downloadBundle(slug, latest.version)
      buffer = dl.buffer
      serverChecksum = dl.checksum
    } catch (err: any) {
      spin.stop()
      ui.fail(`${slug}: download failed — ${err.message}`)
      failed++
      continue
    }

    const localChecksum = computeSha256(buffer)
    if (serverChecksum && localChecksum !== serverChecksum) {
      spin.stop()
      ui.fail(`${slug}: checksum mismatch`)
      failed++
      continue
    }

    spin.text = `Extracting ${slug}@${latest.version}...`
    const tmpDir = path.join(os.tmpdir(), `skillnote-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    try {
      extractZipSafe(buffer, tmpDir)
    } catch (err: any) {
      spin.stop()
      ui.fail(`${slug}: extraction failed — ${err.message}`)
      failed++
      continue
    }

    // Reinstall to the same agents
    const agents = entry.agents
      .map(name => getAdapter(name, projectDir))
      .filter(Boolean) as ReturnType<typeof detectAgents>

    if (agents.length === 0) {
      // Fallback: detect agents again
      const detected = detectAgents(projectDir)
      agents.push(...detected)
    }

    for (const agent of agents) {
      const dest = agent.skillDir(slug)
      // Remove old files
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true })
      fs.mkdirSync(dest, { recursive: true })
      copyDirSync(tmpDir, dest)
      agent.postInstall?.(slug)
    }

    fs.rmSync(tmpDir, { recursive: true, force: true })

    manifest.skills[slug] = {
      version: latest.version,
      checksum: localChecksum,
      installedAt: new Date().toISOString(),
      agents: agents.map(a => a.name),
    }
    saveManifest(projectDir, manifest)

    spin.stop()
    ui.success(`${slug}: ${entry.version} → ${latest.version}`)
    updated++
  }

  if (slugs.length > 1) {
    console.log()
    ui.info(`${updated} updated, ${skipped} up to date, ${failed} failed`)
  }
}
```

**Step 2: Add to `cli/src/index.ts`**

```typescript
import { updateCommand } from './commands/update.js'

// ...

program
  .command('update [skill]')
  .description('Update installed skills to latest version')
  .option('--all', 'Update all installed skills')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(updateCommand)
```

**Step 3: Build and verify**

Run: `cd cli && npm run build && node dist/index.js update --help`
Expected: Shows update command help

**Step 4: Commit**

```bash
git add cli/src/commands/update.ts cli/src/index.ts
git commit -m "feat(cli): add update command with version diff display"
```

---

### Task 13: Remove Command

**Files:**
- Create: `cli/src/commands/remove.ts`
- Modify: `cli/src/index.ts`

**Step 1: Write the implementation**

```typescript
// cli/src/commands/remove.ts
import fs from 'node:fs'
import { loadManifest, saveManifest } from '../manifest/index.js'
import { getAdapter, detectAgents } from '../agents/index.js'
import * as ui from '../util/ui.js'

export async function removeCommand(skill: string): Promise<void> {
  const projectDir = process.cwd()
  const manifest = loadManifest(projectDir)

  if (!manifest.skills[skill]) {
    ui.fail(`${skill} is not installed.`)
    process.exit(1)
  }

  const entry = manifest.skills[skill]

  // Remove files from each agent directory
  for (const agentName of entry.agents) {
    const adapter = getAdapter(agentName, projectDir)
    if (!adapter) continue
    const dir = adapter.skillDir(skill)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true })
    }
  }

  // Remove from manifest
  delete manifest.skills[skill]
  saveManifest(projectDir, manifest)

  ui.success(`Removed ${ui.bold(skill)} from ${entry.agents.join(', ')}`)
}
```

**Step 2: Add to `cli/src/index.ts`**

```typescript
import { removeCommand } from './commands/remove.js'

// ...

program
  .command('remove <skill>')
  .description('Remove an installed skill')
  .action(removeCommand)
```

**Step 3: Build and verify**

Run: `cd cli && npm run build && node dist/index.js remove --help`
Expected: Shows remove command help

**Step 4: Commit**

```bash
git add cli/src/commands/remove.ts cli/src/index.ts
git commit -m "feat(cli): add remove command"
```

---

### Task 14: Doctor Command

**Files:**
- Create: `cli/src/commands/doctor.ts`
- Modify: `cli/src/index.ts`

**Step 1: Write the implementation**

```typescript
// cli/src/commands/doctor.ts
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ApiClient } from '../api/client.js'
import { defaultConfigDir, loadConfig, resolveAuth } from '../config/index.js'
import { loadManifest } from '../manifest/index.js'
import { detectAgents } from '../agents/index.js'
import { computeSha256 } from '../util/checksum.js'
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
        const safe = (stat.mode & 0o077) === 0 // no group/other access
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
            const { getAdapter } = await import('../agents/index.js')
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
```

**Step 2: Add to `cli/src/index.ts`**

```typescript
import { doctorCommand } from './commands/doctor.js'

// ...

program
  .command('doctor')
  .description('Run diagnostics on your SkillNote setup')
  .action(doctorCommand)
```

**Step 3: Build and verify**

Run: `cd cli && npm run build && node dist/index.js doctor --help`
Expected: Shows doctor command help

**Step 4: Commit**

```bash
git add cli/src/commands/doctor.ts cli/src/index.ts
git commit -m "feat(cli): add doctor command with comprehensive diagnostics"
```

---

### Task 15: Final CLI Entry Point (wire all commands)

**Files:**
- Modify: `cli/src/index.ts`

**Step 1: Write the final index.ts with all commands**

```typescript
// cli/src/index.ts
import { Command } from 'commander'
import { loginCommand } from './commands/login.js'
import { listCommand } from './commands/list.js'
import { addCommand } from './commands/add.js'
import { checkCommand } from './commands/check.js'
import { updateCommand } from './commands/update.js'
import { removeCommand } from './commands/remove.js'
import { doctorCommand } from './commands/doctor.js'

const program = new Command()

program
  .name('skillnote')
  .description('CLI for the SkillNote skills registry')
  .version('0.1.0')

program
  .command('login')
  .description('Authenticate with a SkillNote registry')
  .option('--host <url>', 'Registry URL')
  .option('--token <token>', 'Access token')
  .action(loginCommand)

program
  .command('list')
  .description('List skills available from the registry')
  .action(listCommand)

program
  .command('add [skill]')
  .description('Install a skill from the registry')
  .option('--agent <name>', 'Target specific agent (claude, cursor, codex, openclaw, openhands, universal)')
  .option('--all', 'Install all available skills')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(addCommand)

program
  .command('check')
  .description('Check installed skills for updates')
  .action(checkCommand)

program
  .command('update [skill]')
  .description('Update installed skills to latest version')
  .option('--all', 'Update all installed skills')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(updateCommand)

program
  .command('remove <skill>')
  .description('Remove an installed skill')
  .action(removeCommand)

program
  .command('doctor')
  .description('Run diagnostics on your SkillNote setup')
  .action(doctorCommand)

program.parse()
```

**Step 2: Build the final binary**

Run: `cd cli && npm run build`
Expected: `dist/index.js` created, no errors

**Step 3: Test all commands have help**

Run: `cd cli && node dist/index.js --help`
Expected output:
```
Usage: skillnote [options] [command]

CLI for the SkillNote skills registry

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Commands:
  login           Authenticate with a SkillNote registry
  list            List skills available from the registry
  add [skill]     Install a skill from the registry
  check           Check installed skills for updates
  update [skill]  Update installed skills to latest version
  remove <skill>  Remove an installed skill
  doctor          Run diagnostics on your SkillNote setup
  help [command]  display help for command
```

**Step 4: Run all tests**

Run: `cd cli && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat(cli): wire all commands into final entry point"
```

---

### Task 16: End-to-End Integration Test

**Files:**
- Create: `cli/src/__tests__/e2e.test.ts`

This test runs against the real backend (requires `SKILLNOTE_HOST` and `SKILLNOTE_TOKEN` env vars or a running backend at localhost:8082).

**Step 1: Write the E2E test**

```typescript
// cli/src/__tests__/e2e.test.ts
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
  // Build CLI first
  execSync('npm run build', { cwd: path.resolve(__dirname, '../..') })
  // Create a temp project dir
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'skillnote-e2e-'))
  // Create .claude dir so Claude adapter is detected
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
    // Verify files exist
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
```

**Step 2: Build and run E2E tests (requires running backend)**

Run:
```bash
cd cli && npm run build && SKILLNOTE_HOST=http://localhost:8082 SKILLNOTE_TOKEN=skn_dev_demo_token npx vitest run src/__tests__/e2e.test.ts
```
Expected: All 6 tests PASS

**Step 3: Commit**

```bash
git add cli/src/__tests__/e2e.test.ts
git commit -m "test(cli): add E2E integration tests against real backend"
```

---

### Task 17: Add `.skillnote/` to `.gitignore`

**Files:**
- Modify: `cli/.gitignore` (create if doesn't exist)
- Note: Also document that users should add `.skillnote/manifest.json` to their project `.gitignore`

**Step 1: Create `cli/.gitignore`**

```
node_modules/
dist/
*.tgz
```

**Step 2: Commit**

```bash
git add cli/.gitignore
git commit -m "chore(cli): add .gitignore for dist and node_modules"
```

---

## Summary

| Task | Component | Files |
|------|-----------|-------|
| 1 | Project scaffolding | package.json, tsconfig, tsup, vitest, index.ts |
| 2 | Config module | config/index.ts + test |
| 3 | API client | api/client.ts + test |
| 4 | UI utilities | util/ui.ts |
| 5 | Checksum & ZIP utils | util/checksum.ts, util/zip.ts + tests |
| 6 | Manifest module | manifest/index.ts + test |
| 7 | Agent adapters (6) | agents/*.ts + test |
| 8 | Login command | commands/login.ts |
| 9 | List command | commands/list.ts |
| 10 | Add command | commands/add.ts |
| 11 | Check command | commands/check.ts |
| 12 | Update command | commands/update.ts |
| 13 | Remove command | commands/remove.ts |
| 14 | Doctor command | commands/doctor.ts |
| 15 | Final entry point | index.ts (all wired) |
| 16 | E2E integration test | e2e.test.ts |
| 17 | .gitignore | cli/.gitignore |
