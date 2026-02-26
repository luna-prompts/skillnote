// SKILL.md spec rules from https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview

export const NAME_MAX = 64
export const DESC_MAX = 1024

const NAME_PATTERN = /^[a-z0-9-]+$/
const RESERVED_WORDS = ['anthropic', 'claude']
const XML_TAG_RE = /<\/?[a-zA-Z][^>]*>/

export type ValidationError = { field: string; message: string }

export function validateSkillName(name: string): ValidationError[] {
  const errors: ValidationError[] = []
  if (!name.trim()) {
    errors.push({ field: 'name', message: 'Name is required' })
    return errors
  }
  if (name.length > NAME_MAX) {
    errors.push({ field: 'name', message: `Name must be ${NAME_MAX} characters or fewer (currently ${name.length})` })
  }
  if (!NAME_PATTERN.test(name)) {
    errors.push({ field: 'name', message: 'Only lowercase letters, numbers, and hyphens allowed' })
  }
  for (const word of RESERVED_WORDS) {
    if (name.includes(word)) {
      errors.push({ field: 'name', message: `Name cannot contain reserved word "${word}"` })
    }
  }
  if (XML_TAG_RE.test(name)) {
    errors.push({ field: 'name', message: 'Name cannot contain XML tags' })
  }
  return errors
}

export function validateDescription(description: string): ValidationError[] {
  const errors: ValidationError[] = []
  if (!description.trim()) {
    errors.push({ field: 'description', message: 'Description is required' })
    return errors
  }
  if (description.length > DESC_MAX) {
    errors.push({ field: 'description', message: `Description must be ${DESC_MAX} characters or fewer (currently ${description.length})` })
  }
  if (XML_TAG_RE.test(description)) {
    errors.push({ field: 'description', message: 'Description cannot contain XML tags' })
  }
  return errors
}

export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
