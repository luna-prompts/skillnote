import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  otherHolders,
  recordGlobalInstall,
  releaseGlobalInstall,
} from '../manifest/global-registry.js'

/**
 * Codex installs every project's skills into one shared ~/.agents/skills,
 * while install bookkeeping lives in per-project manifests. Without a
 * machine-level ledger, removing a skill in one project deletes the files
 * another project still lists as installed.
 */
describe('global install registry', () => {
  let home: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'skillnote-reg-'))
  })

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('lets the only holder delete the shared files', () => {
    recordGlobalInstall('codex', 'my-skill', '/proj/a', home)
    expect(releaseGlobalInstall('codex', 'my-skill', '/proj/a', home)).toBe(true)
  })

  it('refuses deletion while another project still holds the skill', () => {
    recordGlobalInstall('codex', 'my-skill', '/proj/a', home)
    recordGlobalInstall('codex', 'my-skill', '/proj/b', home)

    expect(releaseGlobalInstall('codex', 'my-skill', '/proj/a', home)).toBe(false)
    expect(otherHolders('codex', 'my-skill', '/proj/a', home)).toEqual(['/proj/b'])

    // Once the last holder releases it, the files can go.
    expect(releaseGlobalInstall('codex', 'my-skill', '/proj/b', home)).toBe(true)
  })

  it('is idempotent for repeated installs from the same project', () => {
    recordGlobalInstall('codex', 'my-skill', '/proj/a', home)
    recordGlobalInstall('codex', 'my-skill', '/proj/a', home)
    expect(releaseGlobalInstall('codex', 'my-skill', '/proj/a', home)).toBe(true)
  })

  it('tracks agents and slugs independently', () => {
    recordGlobalInstall('codex', 'skill-one', '/proj/a', home)
    recordGlobalInstall('codex', 'skill-two', '/proj/a', home)
    expect(releaseGlobalInstall('codex', 'skill-one', '/proj/a', home)).toBe(true)
    expect(otherHolders('codex', 'skill-two', '/proj/b', home)).toEqual(['/proj/a'])
  })

  it('treats a corrupt ledger as empty instead of failing the command', () => {
    fs.mkdirSync(path.join(home, '.skillnote'), { recursive: true })
    fs.writeFileSync(path.join(home, '.skillnote', 'global-installs.json'), 'not json')
    expect(releaseGlobalInstall('codex', 'my-skill', '/proj/a', home)).toBe(true)
  })
})
