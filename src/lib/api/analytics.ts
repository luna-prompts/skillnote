import { apiRequest } from './client'

export type AnalyticsSummary = {
  total_calls: number
  unique_skills: number
  unique_agents: number
  calls_today: number
  most_called_skill: string | null
}

export type SkillCallStat = {
  slug: string
  call_count: number
  last_called_at: string | null
}

export type AgentStat = {
  agent_name: string
  call_count: number
  pct: number
}

export type TimelinePoint = {
  date: string
  call_count: number
}

export type CollectionStat = {
  scope: string | null
  call_count: number
}

export type TopSkillStat = {
  slug: string
  call_count: number
  last_called_at: string | null
  avg_rating: number | null
  rating_count: number
  completion_rate: number
}

export type SkillReview = {
  id: string
  rating: number
  outcome: string | null
  agent_name: string
  skill_version: number
  created_at: string | null
}

export type RatingSummary = {
  total_ratings: number
  overall_avg: number | null
  rated_skills: number
  rating_agents: number
  distribution: Record<number, number>
}

type AnalyticsParams = {
  days?: number
  agent?: string
  collection?: string
}

function buildQuery(params: AnalyticsParams): string {
  const q = new URLSearchParams()
  if (params.days !== undefined) q.set('days', String(params.days))
  if (params.agent) q.set('agent', params.agent)
  if (params.collection) q.set('collection', params.collection)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export function fetchAnalyticsSummary(params: AnalyticsParams = {}) {
  return apiRequest<AnalyticsSummary>(`/v1/analytics/summary${buildQuery(params)}`)
}

export function fetchSkillCalls(params: AnalyticsParams = {}) {
  return apiRequest<SkillCallStat[]>(`/v1/analytics/skill-calls${buildQuery(params)}`)
}

export function fetchAgents(params: AnalyticsParams = {}) {
  return apiRequest<AgentStat[]>(`/v1/analytics/agents${buildQuery(params)}`)
}

export function fetchTimeline(params: AnalyticsParams = {}) {
  return apiRequest<TimelinePoint[]>(`/v1/analytics/timeline${buildQuery(params)}`)
}

export function fetchCollections(params: AnalyticsParams = {}) {
  return apiRequest<CollectionStat[]>(`/v1/analytics/collections${buildQuery(params)}`)
}

export function fetchTopSkills(params: AnalyticsParams & { limit?: number } = {}) {
  const q = new URLSearchParams()
  if (params.days !== undefined) q.set('days', String(params.days))
  if (params.limit !== undefined) q.set('limit', String(params.limit))
  const s = q.toString()
  return apiRequest<TopSkillStat[]>(`/v1/analytics/top-skills${s ? `?${s}` : ''}`)
}

export function fetchSkillReviews(slug: string, limit = 20) {
  return apiRequest<SkillReview[]>(`/v1/analytics/ratings/${slug}/reviews?limit=${limit}`)
}

export function fetchRatingSummary(params: AnalyticsParams = {}) {
  const q = new URLSearchParams()
  if (params.days !== undefined) q.set('days', String(params.days))
  const s = q.toString()
  return apiRequest<RatingSummary>(`/v1/analytics/rating-summary${s ? `?${s}` : ''}`)
}
