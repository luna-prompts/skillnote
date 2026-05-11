/**
 * E2E: [Run via CLI] button on /integrations
 *
 * Verifies the click-through for the CLI bridge:
 *   1. Click button → POST /v1/cli/jobs returns { id }
 *   2. Hook polls GET /v1/cli/jobs/{id} → "running" → "succeeded"
 *   3. Log panel renders progressive output then collapses to ✓ Connected.
 *
 * All bridge endpoints are mocked — no live backend required.
 */

import { test, expect, type Page } from '@playwright/test'

const JOB_ID = 'fake-id'

// State machine for the mock: each GET advances the status.
//   0 → pending     (initial state, returned by POST)
//   1 → running     (first poll)
//   2+ → succeeded  (subsequent polls)
let pollCount = 0

async function setupBridgeMocks(page: Page) {
  pollCount = 0

  // POST /v1/cli/jobs — create a new pending job.
  await page.route('**/v1/cli/jobs', (route, req) => {
    if (req.method() === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: JOB_ID,
          type: 'connect',
          agent: 'claude-code',
          status: 'pending',
          log: [],
          created_at: Date.now() / 1000,
          claimed_at: null,
          finished_at: null,
          exit_code: null,
          error: null,
        }),
      })
    }
    return route.continue()
  })

  // GET /v1/cli/jobs/{id} — progressive state.
  await page.route(`**/v1/cli/jobs/${JOB_ID}`, (route, req) => {
    if (req.method() !== 'GET') return route.continue()

    pollCount += 1
    if (pollCount === 1) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: JOB_ID,
          type: 'connect',
          agent: 'claude-code',
          status: 'running',
          log: ['line 1'],
          created_at: Date.now() / 1000,
          claimed_at: Date.now() / 1000,
          finished_at: null,
          exit_code: null,
          error: null,
        }),
      })
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: JOB_ID,
        type: 'connect',
        agent: 'claude-code',
        status: 'succeeded',
        log: ['line 1', 'line 2'],
        created_at: Date.now() / 1000,
        claimed_at: Date.now() / 1000,
        finished_at: Date.now() / 1000,
        exit_code: 0,
        error: null,
      }),
    })
  })

  // The integrations page calls a few other endpoints on mount — mock them
  // permissively so the page renders without console noise.
  await page.route('**/v1/analytics/skill-calls**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/v1/openclaw/usage**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/setup/agent-prompt**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/markdown', body: '# Prompt' }),
  )
}

test.describe('[Run via CLI] button', () => {
  test('Claude Code: click → log panel → ✓ Connected', async ({ page }) => {
    await setupBridgeMocks(page)
    await page.goto('/integrations')

    // Claude Code tab is selected by default. Click the [Run via CLI] button.
    const runBtn = page.getByTestId('run-via-cli-button')
    await expect(runBtn).toBeVisible({ timeout: 10_000 })
    await runBtn.click()

    // Log panel appears.
    const panel = page.getByTestId('run-via-cli-panel')
    await expect(panel).toBeVisible({ timeout: 5_000 })

    // Eventually shows the second log line streamed from the bridge.
    const log = page.getByTestId('run-via-cli-log')
    await expect(log).toContainText('line 2', { timeout: 5_000 })

    // After collapse delay (~3s), the panel hides and the Connected pill shows.
    const connected = page.getByTestId('run-via-cli-connected')
    await expect(connected).toBeVisible({ timeout: 8_000 })
    await expect(connected).toContainText('Connected')
    await expect(panel).not.toBeVisible()
  })
})
