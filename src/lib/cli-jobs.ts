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
const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set(['succeeded', 'failed', 'cancelled'])

/**
 * Polls /v1/cli/jobs/{id} every 800ms until the job reaches a terminal
 * status. Pass `null` to disable polling (no in-flight job).
 *
 * The hook owns its lifecycle: it clears the timer on unmount or when the
 * jobId changes, and stops polling once a terminal status is observed.
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

    const tick = async () => {
      try {
        const next = await apiRequest<CliJob>(`/v1/cli/jobs/${jobId}`)
        if (cancelledRef.current) return
        setJob(next)
        if (TERMINAL_STATUSES.has(next.status)) {
          setIsPolling(false)
          return
        }
      } catch {
        // Transient errors (e.g. backend hiccup) shouldn't kill polling — just
        // retry on the next tick. If the job truly vanished it'll surface as
        // a stuck "pending" UI state, which is acceptable for a 30-min TTL store.
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
