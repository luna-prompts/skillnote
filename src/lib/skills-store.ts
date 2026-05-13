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
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    // SecurityError (Safari private mode / blocked storage) — treat as empty.
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    // R9 F53: also defend against the right-shape: the parse can succeed
    // but yield a non-array (someone manually wrote `{...}` or `"string"`).
    // Treat anything that isn't an array as corruption and self-heal.
    if (!Array.isArray(parsed)) {
      throw new Error('Stored skills is not an array')
    }
    return parsed as Skill[]
  } catch {
    // R9 F53: corrupted JSON in localStorage would otherwise stay forever —
    // every `getSkills()` falls back to []. Wipe it so the next sync writes
    // clean state instead of leaving the bad string in place.
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    return null
  }
}

/** Notify other components that skills list changed (home page, etc.) */
function notifyChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('skillnote:skills-changed'))
}

/**
 * Single chokepoint for mutating the skills list in localStorage.
 *
 * Every CRUD helper (`addSkill`, `updateSkill`, `deleteSkill`, the slug-rename
 * branch in `saveSkillEdit`, `syncSkillsFromApi`, `clearAndReseed`) MUST go
 * through `commitSkills` — never call `localStorage.setItem` directly.
 *
 * Background: this centralization was forced by repeated reviewer findings.
 * R5 caught that the sidebar count went stale because some mutators forgot
 * to dispatch the change event; R5 added the event listener but had to
 * patch each mutator individually. R7 caught the SAME bug-shape in
 * `syncSkillsFromApi`. R8 reviewer noted "the notifyChanged-not-called-
 * everywhere pattern keeps coming back — centralize it." This is the fix.
 *
 * After this, the rule is enforced by the type system + grep: any new code
 * that wants to mutate the local skills list must import `commitSkills`,
 * which always emits the event. There is no public way to write to
 * localStorage that doesn't notify.
 */
function commitSkills(skills: Skill[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(skills))
  } catch {
    // SecurityError on Safari private / QuotaExceededError on full —
    // expected on locked-down browsers. The notify still fires so any
    // optimistic in-memory state gets a chance to reconcile.
  }
  notifyChanged()
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
    // R9 F32: distinguish "genuinely local" skills (user created while
    // offline, never made it to the API) from "previously-synced ghosts"
    // (skills that WERE on the API but the API has since dropped them,
    // typically because the DB was wiped via `docker compose down -v`).
    //
    // Heuristic: a local skill has `_syncedAt` set iff a prior sync saw
    // it on the API. After a DB wipe, the new API response doesn't
    // include it, but `_syncedAt` is still in localStorage — that's the
    // signal to drop it. Skills with NO `_syncedAt` are genuinely local
    // (created while offline) and survive.
    const localOnly = local.filter(s => !apiSlugs.has(s.slug) && !s._syncedAt)
    const now = new Date().toISOString()
    // Preserve locally-set current_version and latest_version
    // Use backend versions as source of truth
    const resolvedApi = apiSkills.map(s => {
      const localSkill = localBySlug.get(s.slug)
      const stamped = { ...s, _syncedAt: now }
      if (!localSkill) return stamped
      // Preserve local content_md if API returned empty (list endpoint doesn't include content)
      if (!s.content_md && localSkill.content_md) {
        return { ...stamped, content_md: localSkill.content_md }
      }
      return stamped
    })
    const merged = [...localOnly, ...resolvedApi]
    commitSkills(merged)
    setConnectionStatus('online')
    return merged
  } catch {
    setConnectionStatus('offline')
    return getSkills()
  }
}

export function saveSkills(skills: Skill[]): void {
  commitSkills(skills)
}

export function addSkill(skill: Skill): void {
  const skills = getSkills()
  skills.unshift(skill)
  commitSkills(skills)
}

export function updateSkill(slug: string, patch: Partial<Skill>): void {
  const skills = getSkills()
  const idx = skills.findIndex(s => s.slug === slug)
  if (idx === -1) return
  skills[idx] = { ...skills[idx], ...patch, updated_at: new Date().toISOString() }
  commitSkills(skills)
}

export function deleteSkill(slug: string): void {
  const skills = getSkills().filter(s => s.slug !== slug)
  commitSkills(skills)
}

export function clearAndReseed(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // SecurityError on locked-down browsers
  }
  // Dispatch the change event even for clear so listeners reset their view.
  notifyChanged()
}

export async function createSkill(data: {
  title: string
  description: string
  content_md: string
  collections: string[]
  extra_frontmatter?: string
}): Promise<Skill> {
  const slug = slugFromName(data.title)

  try {
    const skill = await createSkillApi({ name: data.title, slug, description: data.description, content_md: data.content_md, collections: data.collections, extra_frontmatter: data.extra_frontmatter })
    // R9 F32: stamp API-created skills with `_syncedAt` so they're tracked
    // for ghost-cleanup. Without the stamp the next sync would treat this
    // skill as "genuinely local" and protect it from cleanup forever.
    addSkill({ ...skill, _syncedAt: new Date().toISOString() })  // addSkill -> commitSkills -> notifyChanged
    return skill
  } catch {
    const now = new Date().toISOString()
    const skill: Skill = { slug, title: data.title, description: data.description, content_md: data.content_md, collections: data.collections, extra_frontmatter: data.extra_frontmatter, current_version: 1, total_versions: 1, created_by: getDisplayName(), created_at: now, updated_at: now }
    addSkill(skill)
    return skill
  }
}

export async function deleteSkillById(slug: string): Promise<void> {
  // Delete from backend first — only remove locally if backend succeeds
  await deleteSkillApi(slug)
  deleteSkill(slug)  // deleteSkill -> commitSkills -> notifyChanged
}

export async function saveSkillEdit(slug: string, patch: { title?: string; description?: string; content_md?: string; collections?: string[]; extra_frontmatter?: string }): Promise<Skill> {
  // Auto-rename the body H1 when the user renames the skill AND the body
  // contains a `# <old-title>` heading line that still matches the prior
  // title (i.e. it's the auto-generated heading from create, not a user-
  // customized one). Without this, the URL/breadcrumb/page-heading all
  // update on rename but the rendered SKILL.md still shows the old name
  // (R8 live-bug L2). The regex uses the `im` flags + no `g`, so it
  // matches the FIRST `# <old-title>` line anywhere in the body and
  // rewrites that one. Subsequent occurrences (rare but possible — user
  // might quote the old name elsewhere) are preserved as user content.
  // The `# <text>` pattern requires a SINGLE `#` followed by whitespace,
  // so `## <old>` and code-block fences like `#$old$` are skipped. The
  // replace preserves leading whitespace via the captured group.
  if (patch.title && patch.content_md !== undefined) {
    const existing = getSkills().find(s => s.slug === slug)
    const oldTitle = existing?.title
    if (oldTitle && oldTitle !== patch.title) {
      const re = new RegExp(
        `^(\\s*)#\\s+${oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
        'im',
      )
      if (re.test(patch.content_md)) {
        patch = {
          ...patch,
          content_md: patch.content_md.replace(re, `$1# ${patch.title}`),
        }
      }
    }
  }

  let apiVersion: number | null = null
  let newSlug: string | null = null
  let apiError: Error | null = null
  try {
    const apiSkill = await updateSkillApi(slug, { name: patch.title, description: patch.description, content_md: patch.content_md, collections: patch.collections, extra_frontmatter: patch.extra_frontmatter })
    apiVersion = apiSkill.current_version
    if (apiSkill.slug !== slug) {
      newSlug = apiSkill.slug
    }
  } catch (err) {
    apiError = err instanceof Error ? err : new Error('API save failed')
  }

  // Use the backend's version if available, otherwise increment locally
  const existing = getSkills().find(s => s.slug === slug)
  const nextVersion = apiVersion ?? ((existing?.current_version ?? 0) + 1)

  if (newSlug) {
    // Slug changed: remove old entry, insert updated skill with new slug
    const skills = getSkills()
    const idx = skills.findIndex(s => s.slug === slug)
    if (idx !== -1) {
      skills[idx] = { ...skills[idx], ...patch, slug: newSlug, current_version: nextVersion, updated_at: new Date().toISOString() }
      commitSkills(skills)
    }
  } else {
    updateSkill(slug, { ...patch, current_version: nextVersion })
  }

  // Return the updated skill so callers can use it directly
  const lookupSlug = newSlug ?? slug
  const updated = getSkills().find(s => s.slug === lookupSlug)
  if (!updated) throw new Error('Skill not found after save')

  // Attach api save status so caller can show appropriate feedback
  if (apiError) {
    (updated as Skill & { _savedLocally?: boolean })._savedLocally = true
  }
  return updated
}
