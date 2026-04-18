// src/lib/collection-validation.ts
// Mirror of backend/app/validators/collection_validator.py

export const COLLECTION_NAME_MAX = 128

const NAME_PATTERN = /^[a-z0-9_-]+$/
const RESERVED_WORDS = ['anthropic', 'claude']
const XML_TAG_RE = /<\/?[a-zA-Z][^>]*>/

export type ValidationError = { field: string; message: string }

export function validateCollectionName(name: string): ValidationError[] {
  const errors: ValidationError[] = []
  if (!name || !name.trim()) {
    errors.push({ field: 'name', message: 'Name is required' })
    return errors
  }
  const stripped = name.trim()
  if (stripped.length > COLLECTION_NAME_MAX) {
    errors.push({ field: 'name', message: `Name must be ${COLLECTION_NAME_MAX} characters or fewer` })
  }
  if (!NAME_PATTERN.test(stripped)) {
    errors.push({ field: 'name', message: 'Only lowercase letters, numbers, hyphens, and underscores allowed' })
  }
  for (const word of RESERVED_WORDS) {
    if (stripped.includes(word)) {
      errors.push({ field: 'name', message: `Name cannot contain reserved word "${word}"` })
    }
  }
  if (XML_TAG_RE.test(stripped)) {
    errors.push({ field: 'name', message: 'Name cannot contain XML tags' })
  }
  return errors
}

/** Slugify algorithm — shared with the slugify migration + picker's folder-suggestion. */
export function slugifyCollectionName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')   // runs of invalid → single hyphen
    .replace(/-+/g, '-')              // collapse consecutive hyphens
    .replace(/^-|-$/g, '')            // strip leading/trailing hyphens
    .slice(0, COLLECTION_NAME_MAX)
}

export function isValidCollectionSlug(s: string): boolean {
  return validateCollectionName(s).length === 0
}
