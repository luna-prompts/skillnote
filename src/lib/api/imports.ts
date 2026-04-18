import { apiRequest } from './client'

export type InspectPayload = {
  input: string
  github_token?: string
  subpath?: string
}

export type ParsedSource = {
  source_type: string
  url?: string
  host?: string
  owner?: string
  repo?: string
  ref?: string
  resolved_sha?: string
  subpath?: string
}

export type InspectSkill = {
  name: string
  description?: string
  path?: string
  content_hash?: string
  license?: string
}

export type InspectResponse = {
  source: ParsedSource
  kind?: string
  skills: InspectSkill[]
  manifest?: Record<string, unknown>
  warnings: Array<{ code: string; message: string }>
  suggested_collection_slug?: string
  existing_source_id?: string | null
}

export function inspectSource(payload: InspectPayload) {
  return apiRequest<InspectResponse>('/v1/import/inspect', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type ApplyPayload = {
  input: string
  github_token?: string
  subpath?: string
  target_collection_slug?: string
  skill_selection?: string[]
  on_conflict?: 'rename' | 'skip' | 'replace'
}

export type ApplyResponse = {
  source_id: string
  collection_slug: string
  imported: Array<{ name: string; slug: string; original_name?: string; renamed_reason?: string }>
  skipped: Array<{ name: string; reason: string }>
}

export function applyImport(payload: ApplyPayload) {
  return apiRequest<ApplyResponse>('/v1/import/apply', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type SourceListItem = {
  id: string
  url: string
  host?: string
  owner?: string
  repo?: string
  ref?: string
  kind: string
  collection_slug: string
  pinned: boolean
  imported_at_sha?: string
  upstream_sha?: string
  last_synced_at?: string
  last_checked_at?: string
  status: 'up_to_date' | 'drift' | 'unreachable' | 'error'
  skill_count: number
  drift_summary?: { new: number; changed: number; removed: number }
}

export function listSources() {
  return apiRequest<SourceListItem[]>('/v1/import/sources')
}

export function refreshSource(id: string, mode: 'preview' | 'apply' = 'preview') {
  return apiRequest(`/v1/import/sources/${id}/refresh`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  })
}

export function deleteSource(id: string, removeSkills = false) {
  return apiRequest<void>(`/v1/import/sources/${id}?remove_skills=${removeSkills}`, {
    method: 'DELETE',
  })
}
