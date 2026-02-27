'use client'

import { Skill } from './mock-data'
import { fetchSkills, createSkillApi, updateSkillApi, deleteSkillApi } from './api/skills'
import { SkillNoteApiError } from './api/client'
import { slugFromName } from './skill-validation'
import { getDisplayName } from './profile'

const STORAGE_KEY = 'skillnote:skills'

type ConnectionStatus = 'online' | 'offline'
let _connectionStatus: ConnectionStatus = 'offline'
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
  try {
    const apiSkills = await fetchSkills()
    // Merge: keep local-only skills (not on API) so imports aren't wiped
    const local = getSkills()
    const localBySlug = new Map(local.map(s => [s.slug, s]))
    const apiSlugs = new Set(apiSkills.map(s => s.slug))
    const localOnly = local.filter(s => !apiSlugs.has(s.slug))
    // Preserve locally-set current_version and latest_version
    // Use backend versions as source of truth
    const resolvedApi = apiSkills.map(s => {
      const localSkill = localBySlug.get(s.slug)
      if (!localSkill) return s
      // Preserve local content_md if API returned empty (list endpoint doesn't include content)
      if (!s.content_md && localSkill.content_md) {
        return { ...s, content_md: localSkill.content_md }
      }
      return s
    })
    const merged = [...localOnly, ...resolvedApi]
    writeStorage(merged)
    setConnectionStatus('online')
    return merged
  } catch {
    setConnectionStatus('offline')
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

  try {
    const skill = await createSkillApi({ name: data.title, slug, ...data })
    addSkill(skill)
    notifyChanged()
    return skill
  } catch {
    const now = new Date().toISOString()
    const skill: Skill = { slug, title: data.title, description: data.description, content_md: data.content_md, tags: data.tags, collections: data.collections, current_version: 1, latest_version: 1, created_by: getDisplayName(), created_at: now, updated_at: now }
    addSkill(skill)
    notifyChanged()
    return skill
  }
}

export async function deleteSkillById(slug: string): Promise<void> {
  try {
    await deleteSkillApi(slug)
  } catch {}
  deleteSkill(slug)
  notifyChanged()
}

export async function saveSkillEdit(slug: string, patch: { title?: string; description?: string; content_md?: string; tags?: string[]; collections?: string[] }): Promise<Skill> {
  let apiVersion: number | null = null
  try {
    const apiSkill = await updateSkillApi(slug, { name: patch.title, description: patch.description, content_md: patch.content_md, tags: patch.tags, collections: patch.collections })
    apiVersion = apiSkill.current_version
  } catch {}

  // Use the backend's version if available, otherwise increment locally
  const existing = getSkills().find(s => s.slug === slug)
  const nextVersion = apiVersion ?? ((existing?.current_version ?? 0) + 1)
  updateSkill(slug, { ...patch, current_version: nextVersion })
  notifyChanged()
  // Return the updated skill so callers can use it directly
  const updated = getSkills().find(s => s.slug === slug)
  if (!updated) throw new Error('Skill not found after save')
  return updated
}
