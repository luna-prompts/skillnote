/**
 * CLI ↔ Web bridge client.
 *
 * Posts jobs to the backend's /v1/cli endpoints, where a long-polling
 * `skillnote bridge` process claims and runs them. Used by the integrations
 * page to drive [Run via CLI] buttons.
 *
 * Backend contract lives in backend/app/api/cli.py.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '@/lib/api/client'

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type JobType = 'connect' | 'disconnect' | 'reconnect' | 'open'
export type JobAgent = 'claude-code' | 'openclaw'

export type CliJob = {
  id: string
  type: JobType
  agent: string
  status: JobStatus
  log: string[]
  created_at: number
  claimed_at: number | null
  finished_at: number | null
  exit_code: number | null
  error: string | null
}

export type DispatchJobInput = { type: JobType; agent: JobAgent }

export async function dispatchJob(input: DispatchJobInput): Promise<{ id: string }> {
  // apiRequest threads through the same base URL resolution everything else
  // uses (localStorage > NEXT_PUBLIC_API_BASE_URL > localhost:8082).
  const job = await apiRequest<CliJob>('/v1/cli/jobs', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return { id: job.id }
}

const POLL_INTERVAL_MS = 800
// After this many consecutive poll failures we stop and surface an error.
// At 800ms interval, 6 misses ≈ 5s of API unreachability — long enough to
// ride out a single backend deploy but short enough that a permanent outage
// doesn't leave the UI silently spinning for the 30-min TTL window.
const MAX_CONSECUTIVE_FAILURES = 6
const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set(['succeeded', 'failed', 'cancelled'])

/**
 * Polls /v1/cli/jobs/{id} every 800ms until the job reaches a terminal
 * status. Pass `null` to disable polling (no in-flight job).
 *
 * The hook owns its lifecycle: it clears the timer on unmount or when the
 * jobId changes, and stops polling once a terminal status is observed.
 *
 * If polling fails MAX_CONSECUTIVE_FAILURES times in a row, the hook
 * synthesizes a `failed` job and stops. Without this, a permanently-5xx
 * backend would leave the modal spinning forever (the 30-min TTL hides it).
 */
export function useJobPolling(jobId: string | null): { job: CliJob | null; isPolling: boolean } {
  const [job, setJob] = useState<CliJob | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  // Track cancellation so a stale fetch resolving after unmount can't update state.
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (!jobId) {
      setJob(null)
      setIsPolling(false)
      return
    }

    cancelledRef.current = false
    setIsPolling(true)
    let timer: ReturnType<typeof setTimeout> | null = null
    let consecutiveFailures = 0

    const tick = async () => {
      try {
        const next = await apiRequest<CliJob>(`/v1/cli/jobs/${jobId}`)
        if (cancelledRef.current) return
        consecutiveFailures = 0
        setJob(next)
        if (TERMINAL_STATUSES.has(next.status)) {
          setIsPolling(false)
          return
        }
      } catch (err) {
        if (cancelledRef.current) return
        consecutiveFailures += 1
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          // Synthesize a failed-job payload so the modal can show an error
          // panel instead of spinning. The error message is what the caller
          // surfaces in toasts; keep it user-readable.
          // `agent: ''` because we don't actually know it from the jobId
          // alone — every consumer keys off `pendingJob.agent` or the parent
          // component's `agentId` prop, not `job.agent`, so this is safe.
          const msg = err instanceof Error ? err.message : 'unknown error'
          setJob({
            id: jobId,
            type: 'connect',
            agent: '',
            status: 'failed',
            log: [],
            created_at: 0,
            claimed_at: null,
            finished_at: Date.now(),
            exit_code: null,
            error: `Bridge unreachable after ${MAX_CONSECUTIVE_FAILURES} attempts (${msg}). Try the manual install or check that \`skillnote bridge\` is running.`,
          })
          setIsPolling(false)
          return
        }
        // Below the threshold: retry on next tick (handled below).
      }
      if (!cancelledRef.current) {
        timer = setTimeout(tick, POLL_INTERVAL_MS)
      }
    }

    // Kick off immediately so the panel doesn't sit empty for 800ms.
    tick()

    return () => {
      cancelledRef.current = true
      if (timer) clearTimeout(timer)
      setIsPolling(false)
    }
  }, [jobId])

  return { job, isPolling }
}
