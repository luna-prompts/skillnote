const KEY_FIRST = 'skillnote:profile-first-name'
const KEY_LAST = 'skillnote:profile-last-name'

export type UserProfile = {
  firstName: string
  lastName: string
}

export function getProfile(): UserProfile {
  if (typeof window === 'undefined') return { firstName: '', lastName: '' }
  return {
    firstName: localStorage.getItem(KEY_FIRST) || '',
    lastName: localStorage.getItem(KEY_LAST) || '',
  }
}

export function setProfile(profile: UserProfile): void {
  localStorage.setItem(KEY_FIRST, profile.firstName.trim())
  localStorage.setItem(KEY_LAST, profile.lastName.trim())
}

export function getDisplayName(): string {
  const { firstName, lastName } = getProfile()
  const full = [firstName, lastName].filter(Boolean).join(' ')
  return full || 'Anonymous'
}
