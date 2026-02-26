'use client'

import { Skill } from './mock-data'
import { fetchSkills, createSkillApi, updateSkillApi, deleteSkillApi } from './api/skills'
import { isConfigured, SkillNoteApiError } from './api/client'
import { slugFromName } from './skill-validation'

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

function writeStorage(skills: Skill[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(skills)) } catch {}
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
    const skills = await fetchSkills()
    writeStorage(skills)
    setConnectionStatus('online')
    return skills
  } catch (err) {
    if (err instanceof SkillNoteApiError && (err.status === 401 || err.status === 403)) {
      setConnectionStatus('unconfigured')  // auth issue — treat same as unconfigured
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
    return skill
  } else {
    const now = new Date().toISOString()
    const skill: Skill = { slug, title: data.title, description: data.description, content_md: data.content_md, tags: data.tags, collections: data.collections, created_at: now, updated_at: now }
    addSkill(skill)
    return skill
  }
}

export async function deleteSkillById(slug: string): Promise<void> {
  if (isConfigured()) {
    await deleteSkillApi(slug)
  }
  deleteSkill(slug)
}

export async function saveSkillEdit(slug: string, patch: { title?: string; description?: string; content_md?: string; tags?: string[]; collections?: string[] }): Promise<void> {
  if (isConfigured()) {
    await updateSkillApi(slug, { name: patch.title, description: patch.description, content_md: patch.content_md, tags: patch.tags, collections: patch.collections })
  }
  updateSkill(slug, patch)
}
