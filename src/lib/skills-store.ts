'use client'

import { Skill, mockSkills } from './mock-data'

const STORAGE_KEY = 'skillnote:skills'

function readStorage(): Skill[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Skill[]
  } catch {
    return null
  }
}

function writeStorage(skills: Skill[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(skills))
  } catch {
    // localStorage full or unavailable
  }
}

export function getSkills(): Skill[] {
  const stored = readStorage()
  if (stored && stored.length > 0) return stored
  // Seed from mock data on first load
  writeStorage(mockSkills)
  return [...mockSkills]
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
  writeStorage(mockSkills)
}
