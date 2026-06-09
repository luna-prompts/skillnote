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

/** A browser-pairing request awaiting approval — surfaced in the notifications
 *  bell so the user can approve from anywhere (verifying the code against their
 *  extension) instead of a full-page interstitial. */
export interface PendingPairing {
  integration_id: string
  browser_label: string | null
  pairing_code: string
  created_at: string | null
  expires_at: string | null
}

export function fetchPendingPairings(): Promise<PendingPairing[]> {
  return apiRequest<PendingPairing[]>('/v1/integrations/claude-ai/pairings/pending')
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
  | 'op_retried'
  | 'sync_triggered'

export interface AuditEventOut {
  id: string
  integration_id: string | null
  event: AuditEvent
  skill_id: string | null
  /** Human-readable skill slug resolved from skill_id (when the event
   *  concerns a specific skill), so the feed shows a name not an opaque ID. */
  skill_slug: string | null
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

// ── Integration list cache (iter 29a) ───────────────────────────────────────
//
// SkillSyncBadge calls listIntegrations() on every mount. Without
// caching, browsing 10 skills in 30s issues 10 identical fetches.
// 60s TTL keyed by base URL — short enough to pick up a new pairing
// when the user opens settings → pairs → comes back, long enough to
// elide drive-by mount thrash.

interface CachedIntegrations {
  fetchedAt: number
  promise: Promise<IntegrationStatusResponse[]>
}
const _integrationsCache = new Map<string, CachedIntegrations>()
const _INTEGRATIONS_CACHE_TTL_MS = 60_000

export function listIntegrationsCached(): Promise<IntegrationStatusResponse[]> {
  const key = getApiBaseUrl()
  const hit = _integrationsCache.get(key)
  const now = Date.now()
  if (hit && now - hit.fetchedAt < _INTEGRATIONS_CACHE_TTL_MS) {
    return hit.promise
  }
  const p = listIntegrations().catch((e) => {
    // Evict on error so the next caller re-fetches instead of getting
    // the cached rejection forever.
    _integrationsCache.delete(key)
    throw e
  })
  _integrationsCache.set(key, { fetchedAt: now, promise: p })
  return p
}

/** Explicit cache invalidation hook for places that just paired or
 *  disconnected an integration and want the next badge mount to
 *  see fresh data. */
export function invalidateIntegrationsCache(): void {
  _integrationsCache.clear()
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

export interface TopUsedSkillStat {
  skill_slug: string
  invocations: number
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
  // Usage: how often Claude invoked the skill on claude.ai.
  invocations_24h: number
  invocations_7d: number
  top_used_skills_7d: TopUsedSkillStat[]
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

// ── Failed-op retry (iter 23a) ───────────────────────────────────────────────

export function retryFailedOperation(op_id: string): Promise<void> {
  return apiRequest(`/v1/integrations/claude-ai/operations/${op_id}/retry`, {
    method: 'POST',
  })
}

// ── Token rotation (iter 23b) ───────────────────────────────────────────────

export interface TokenRotateResponse {
  integration_id: string
  new_extension_token: string
  rotated_at: string
}

export function rotateExtensionToken(integration_id: string): Promise<TokenRotateResponse> {
  return apiRequest(
    `/v1/integrations/claude-ai/integrations/${integration_id}/rotate-token`,
    { method: 'POST' },
  )
}

// ── Trigger sync (iter 25a) ─────────────────────────────────────────────────

export function triggerSync(integration_id: string): Promise<void> {
  return apiRequest(
    `/v1/integrations/claude-ai/integrations/${integration_id}/trigger-sync`,
    { method: 'POST' },
  )
}

export function fetchSyncQueue(opts: { integration_id?: string; limit?: number } = {}): Promise<SyncQueueResponse> {
  const q = new URLSearchParams()
  if (opts.integration_id) q.set('integration_id', opts.integration_id)
  if (opts.limit) q.set('limit', String(opts.limit))
  const qs = q.toString()
  return apiRequest(`/v1/integrations/claude-ai/queue${qs ? `?${qs}` : ''}`)
}

// ── Per-skill sync status (iter 29c) ────────────────────────────────────────

export interface SkillSyncLinkStat {
  integration_id: string
  integration_label: string | null
  integration_status: IntegrationStatus
  claude_ai_skill_id: string
  claude_ai_version: string | null
  conflict_state: 'none' | 'diverged' | 'resolved'
  last_seen_at: string | null
  direction: 'outbound' | 'inbound' | 'both'
}

export interface SkillSyncStatusResponse {
  skill_id: string
  skill_slug: string
  claude_ai_sync_enabled: boolean
  links: SkillSyncLinkStat[]
  pending_op_count: number
}

export function fetchSkillSyncStatus(skill_slug: string): Promise<SkillSyncStatusResponse> {
  return apiRequest(
    `/v1/integrations/claude-ai/skills/${encodeURIComponent(skill_slug)}/sync-status`,
  )
}

// ── Per-skill sync toggle ────────────────────────────────────────────────────

export function toggleSkillSync(skill_id: string, enabled: boolean): Promise<void> {
  return apiRequest(`/v1/integrations/claude-ai/skills/${skill_id}/sync`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  })
}
