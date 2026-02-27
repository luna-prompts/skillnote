'use client'

import { Skill } from './mock-data'
import { fetchSkills, createSkillApi, updateSkillApi, deleteSkillApi } from './api/skills'
import { isConfigured, SkillNoteApiError } from './api/client'
import { slugFromName } from './skill-validation'
import { getDisplayName } from './profile'

const STORAGE_KEY = 'skillnote:skills'

type ConnectionStatus = 'online' | 'offline' | 'unconfigured'
let _connectionStatus: ConnectionStatus = 'unconfigured'
const _listeners: Array<(s: ConnectionStatus) => void> = []

export function getConnectionStatus(): ConnectionStatus {
  return _connectionStatus
}

function setConnectionStatus(s: ConnectionStatus) {
  _connectionStatus = s
  _listeners.forEach(fn => fn(s))
}

export function onConnectionStatusChange(fn: (s: ConnectionStatus) => void) {
  _listeners.push(fn)
  return () => { const i = _listeners.indexOf(fn); if (i !== -1) _listeners.splice(i, 1) }
}

function readStorage(): Skill[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Skill[]
  } catch { return null }
}

/** Write to localStorage only — no event dispatch */
function writeStorage(skills: Skill[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(skills)) } catch {}
}

/** Notify other components that skills list changed (home page, etc.) */
function notifyChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('skillnote:skills-changed'))
}

export function getSkills(): Skill[] {
  return readStorage() || []
}

export async function syncSkillsFromApi(): Promise<Skill[]> {
  if (!isConfigured()) {
    setConnectionStatus('unconfigured')
    return getSkills()
  }
  try {
    const apiSkills = await fetchSkills()
    // Merge: keep local-only skills (not on API) so imports aren't wiped
    const local = getSkills()
    const localBySlug = new Map(local.map(s => [s.slug, s]))
    const apiSlugs = new Set(apiSkills.map(s => s.slug))
    const localOnly = local.filter(s => !apiSlugs.has(s.slug))
    // Preserve locally-set current_version and latest_version
    const resolvedApi = apiSkills.map(s => {
      const localSkill = localBySlug.get(s.slug)
      if (!localSkill) return s
      const resolved = { ...s }
      // Preserve current_version if user set an older version as latest
      if (localSkill.current_version > 0 && localSkill.current_version < s.current_version) {
        resolved.current_version = localSkill.current_version
      }
      // Preserve latest_version (total version counter)
      resolved.latest_version = Math.max(s.current_version, localSkill.latest_version ?? 0)
      return resolved
    })
    const merged = [...localOnly, ...resolvedApi]
    writeStorage(merged)
    setConnectionStatus('online')
    return merged
  } catch (err) {
    if (err instanceof SkillNoteApiError && (err.status === 401 || err.status === 403)) {
      setConnectionStatus('unconfigured')
    } else {
      setConnectionStatus('offline')
    }
    return getSkills()
  }
}

export function saveSkills(skills: Skill[]): void {
  writeStorage(skills)
}

export function addSkill(skill: Skill): void {
  const skills = getSkills()
  skills.unshift(skill)
  writeStorage(skills)
  notifyChanged()
}

export function updateSkill(slug: string, patch: Partial<Skill>): void {
  const skills = getSkills()
  const idx = skills.findIndex(s => s.slug === slug)
  if (idx === -1) return
  skills[idx] = { ...skills[idx], ...patch, updated_at: new Date().toISOString() }
  writeStorage(skills)
}

export function deleteSkill(slug: string): void {
  const skills = getSkills().filter(s => s.slug !== slug)
  writeStorage(skills)
}

export function clearAndReseed(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export async function createSkill(data: {
  title: string
  description: string
  content_md: string
  tags: string[]
  collections: string[]
}): Promise<Skill> {
  const slug = slugFromName(data.title)

  if (isConfigured()) {
    const skill = await createSkillApi({ name: data.title, slug, ...data })
    addSkill(skill)
    notifyChanged()
    return skill
  } else {
    const now = new Date().toISOString()
    const skill: Skill = { slug, title: data.title, description: data.description, content_md: data.content_md, tags: data.tags, collections: data.collections, current_version: 1, latest_version: 1, created_by: getDisplayName(), created_at: now, updated_at: now }
    addSkill(skill)
    notifyChanged()
    return skill
  }
}

export async function deleteSkillById(slug: string): Promise<void> {
  if (isConfigured()) {
    await deleteSkillApi(slug)
  }
  deleteSkill(slug)
  notifyChanged()
}

export async function saveSkillEdit(slug: string, patch: { title?: string; description?: string; content_md?: string; tags?: string[]; collections?: string[] }): Promise<Skill> {
  if (isConfigured()) {
    await updateSkillApi(slug, { name: patch.title, description: patch.description, content_md: patch.content_md, tags: patch.tags, collections: patch.collections })
  }
  // Increment version counter and set as active
  const existing = getSkills().find(s => s.slug === slug)
  const totalVersions = existing?.latest_version ?? existing?.current_version ?? 0
  const nextVersion = totalVersions + 1
  updateSkill(slug, { ...patch, current_version: nextVersion, latest_version: nextVersion })
  notifyChanged()
  // Return the updated skill so callers can use it directly
  const updated = getSkills().find(s => s.slug === slug)
  if (!updated) throw new Error('Skill not found after save')
  return updated
}
