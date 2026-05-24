// API client for the claude.ai connector — wraps the backend's
// /v1/integrations/claude-ai/ routes. Mirrors the Pydantic schemas in
// backend/app/schemas/claude_ai.py. Keep them in sync.

import { apiRequest, getApiBaseUrl } from './client'

export type IntegrationStatus =
  | 'pending_approval'
  | 'active'
  | 'cookie_expired'
  | 'disconnected'
  | 'error'

export interface IntegrationStatusResponse {
  id: string
  browser_label: string | null
  status: IntegrationStatus
  scope: 'personal' | 'organization' | 'both'
  claude_ai_org_id: string | null
  last_sync_at: string | null
  last_error: string | null
  conflict_policy: 'ask' | 'skillnote_wins' | 'claude_ai_wins'
  pending_op_count: number
  failed_op_count: number
  linked_skill_count: number
}

export interface ConflictListItem {
  link_id: string
  integration_id: string
  integration_label: string | null
  skillnote_skill_id: string | null
  skillnote_skill_slug: string | null
  skillnote_skill_name: string | null
  claude_ai_skill_id: string
  claude_ai_version: string | null
  last_seen_at: string | null
}

export function listIntegrations(): Promise<IntegrationStatusResponse[]> {
  return apiRequest('/v1/integrations/claude-ai/integrations')
}

export function approvePairing(pairing_code: string): Promise<void> {
  return apiRequest('/v1/integrations/claude-ai/pair/approve', {
    method: 'POST',
    body: JSON.stringify({ pairing_code }),
  })
}

export function disconnectIntegration(id: string): Promise<void> {
  return apiRequest(`/v1/integrations/claude-ai/integrations/${id}`, {
    method: 'DELETE',
  })
}

export function patchIntegration(
  id: string,
  patch: Partial<Pick<IntegrationStatusResponse, 'scope' | 'conflict_policy' | 'browser_label'>>,
): Promise<IntegrationStatusResponse> {
  return apiRequest(`/v1/integrations/claude-ai/integrations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function listConflicts(): Promise<ConflictListItem[]> {
  return apiRequest('/v1/integrations/claude-ai/conflicts')
}

export function resolveConflict(
  link_id: string,
  resolution: 'keep_skillnote' | 'keep_claude_ai' | 'skip',
): Promise<void> {
  return apiRequest(`/v1/integrations/claude-ai/conflicts/${link_id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolution }),
  })
}

// ── Activity feed ────────────────────────────────────────────────────────────

export type AuditEvent =
  | 'pair_started'
  | 'pair_approved'
  | 'pair_redeemed'
  | 'pair_expired'
  | 'integration_disconnected'
  | 'integration_updated'
  | 'skill_pushed'
  | 'skill_imported'
  | 'skill_delete_pushed'
  | 'op_failed'
  | 'cookie_expired'
  | 'conflict_detected'
  | 'conflict_resolved'
  | 'endpoint_changed'
  | 'token_revoked'

export interface AuditEventOut {
  id: string
  integration_id: string | null
  event: AuditEvent
  skill_id: string | null
  detail: Record<string, unknown>
  created_at: string
}

export interface ListActivityOptions {
  integration_id?: string
  event?: AuditEvent
  skill_id?: string
  limit?: number
  /** Cursor for pagination — pass `created_at` of the last row of the
   * previous page to fetch the next (older) page. */
  before?: string
  /** Inclusive lower bound for the audit window (ISO timestamp). */
  since?: string
  /** Inclusive upper bound for the audit window (ISO timestamp). */
  until?: string
}

function activityQuery(opts: ListActivityOptions): URLSearchParams {
  const q = new URLSearchParams()
  if (opts.integration_id) q.set('integration_id', opts.integration_id)
  if (opts.event) q.set('event', opts.event)
  if (opts.skill_id) q.set('skill_id', opts.skill_id)
  if (opts.limit) q.set('limit', String(opts.limit))
  if (opts.before) q.set('before', opts.before)
  if (opts.since) q.set('since', opts.since)
  if (opts.until) q.set('until', opts.until)
  return q
}

export function listActivity(opts: ListActivityOptions = {}): Promise<AuditEventOut[]> {
  const qs = activityQuery(opts).toString()
  return apiRequest(`/v1/integrations/claude-ai/activity${qs ? `?${qs}` : ''}`)
}

/** Builds the download URL for the activity CSV export. Use as an
 *  anchor href — the browser triggers a download via Content-Disposition. */
export function activityExportUrl(opts: ListActivityOptions = {}): string {
  const base = getApiBaseUrl()
  const qs = activityQuery(opts).toString()
  return `${base}/v1/integrations/claude-ai/activity/export.csv${qs ? `?${qs}` : ''}`
}

// ── Health metrics ───────────────────────────────────────────────────────────

export interface HealthMetrics {
  integrations_active: number
  integrations_with_errors: number
  pending_ops_total: number
  failed_ops_total: number
  diverged_links_total: number
  last_audit_at: string | null
  schema_version: string
}

export function fetchHealth(): Promise<HealthMetrics> {
  return apiRequest('/v1/integrations/claude-ai/health')
}

// ── Sync queue (iter 17) ─────────────────────────────────────────────────────

export type SyncOpKind = 'upload' | 'update' | 'delete' | 'list' | 'fetch_one'
export type SyncOpStatus = 'pending' | 'in_progress'

export interface SyncQueueItem {
  id: string
  kind: SyncOpKind
  status: SyncOpStatus
  attempts: number
  last_error: string | null
  created_at: string
  started_at: string | null
  integration_id: string
  integration_label: string | null
  skill_id: string | null
  skill_slug: string | null
  skill_name: string | null
}

export interface SyncQueueResponse {
  items: SyncQueueItem[]
  total: number
  pending_count: number
  in_progress_count: number
  oldest_age_seconds: number | null
}

// ── Analytics (iter 18) ──────────────────────────────────────────────────────

export interface TopSkillStat {
  skill_id: string
  skill_slug: string
  skill_name: string
  sync_count: number
}

export interface IntegrationActivityStat {
  integration_id: string
  integration_label: string | null
  syncs_24h: number
  failed_24h: number
  last_sync_at: string | null
}

export interface SparklinePoint {
  date: string
  syncs: number
  failed: number
}

export interface AnalyticsResponse {
  skills_synced_24h: number
  skills_synced_7d: number
  failed_24h: number
  failed_7d: number
  sync_success_rate_7d: number
  avg_attempts_per_sync_7d: number
  top_skills_7d: TopSkillStat[]
  per_integration: IntegrationActivityStat[]
  sparkline_7d: SparklinePoint[]
}

export function fetchAnalytics(): Promise<AnalyticsResponse> {
  return apiRequest('/v1/integrations/claude-ai/analytics')
}

// ── Conflict preview (iter 20) ───────────────────────────────────────────────

export interface ConflictPreview {
  link_id: string
  integration_id: string
  integration_label: string | null
  skill_id: string | null
  skill_slug: string | null
  skill_name: string | null
  last_pushed_version_id: string | null
  last_pushed_version_number: number | null
  last_pushed_content_md: string | null
  current_version_id: string | null
  current_version_number: number | null
  current_content_md: string | null
  local_changed: boolean
  claude_ai_skill_id: string
  claude_ai_version: string | null
  claude_ai_last_seen_at: string | null
}

export function fetchConflictPreview(link_id: string): Promise<ConflictPreview> {
  return apiRequest(`/v1/integrations/claude-ai/conflicts/${link_id}/preview`)
}

// ── Diagnostic (iter 21) ─────────────────────────────────────────────────────

export interface DiagnosticCheck {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

export interface DiagnosticResponse {
  overall: 'pass' | 'warn' | 'fail'
  checks: DiagnosticCheck[]
  generated_at: string
}

export function runDiagnostic(): Promise<DiagnosticResponse> {
  return apiRequest('/v1/integrations/claude-ai/diagnostic')
}

export function fetchSyncQueue(opts: { integration_id?: string; limit?: number } = {}): Promise<SyncQueueResponse> {
  const q = new URLSearchParams()
  if (opts.integration_id) q.set('integration_id', opts.integration_id)
  if (opts.limit) q.set('limit', String(opts.limit))
  const qs = q.toString()
  return apiRequest(`/v1/integrations/claude-ai/queue${qs ? `?${qs}` : ''}`)
}

// ── Per-skill sync toggle ────────────────────────────────────────────────────

export function toggleSkillSync(skill_id: string, enabled: boolean): Promise<void> {
  return apiRequest(`/v1/integrations/claude-ai/skills/${skill_id}/sync`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  })
}
