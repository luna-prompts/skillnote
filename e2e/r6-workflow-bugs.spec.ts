/**
 * Round 6 regressions — broader live-workflow audit.
 *
 * L1: marketplace input previously left the Import button silently disabled
 *     for invalid URLs. Fix added an inline error message. This test asserts
 *     the message appears for non-URL input.
 * L2: analytics donut chart previously rendered one slice per raw agent_name
 *     even when categorize() mapped two raw names to the same display label.
 *     Fix consolidates by category. This test mocks two agent rows whose
 *     names both categorize as "Claude Code" and asserts only one slice
 *     surfaces with summed call counts.
 * L3 (phantom skills in leaderboard): deferred to R7 — fix requires a
 *     registry cross-ref design.
 *
 * `verified-r6` flows (no regression test added here — they pass by current
 * behaviour and no R6 fix touches them): delete-from-detail page redirect,
 * api-offline ConnectionBanner, api-recovery auto-dismiss, reserved-word
 * validation message clarity.
 */
import { test, expect, type Route } from '@playwright/test'

test.describe('R6 — marketplace invalid URL shows inline error', () => {
  test('typing non-URL text surfaces "Not a recognized URL" inline', async ({ page }) => {
    await page.goto('/marketplace')
    const input = page.getByRole('textbox', { name: 'Repository or URL' })
    await input.fill('not a real url')

    await expect(
      page.getByText(/Not a recognized URL\. Try/i),
    ).toBeVisible({ timeout: 5_000 })
    // Import button stays disabled (already the prior behaviour; assert it
    // didn't regress).
    await expect(page.getByRole('button', { name: /^Import$/ })).toBeDisabled()
  })

  test('clearing the input removes the inline error', async ({ page }) => {
    await page.goto('/marketplace')
    const input = page.getByRole('textbox', { name: 'Repository or URL' })
    await input.fill('garbage')
    await expect(page.getByText(/Not a recognized URL/i)).toBeVisible()

    await input.fill('')
    await expect(page.getByText(/Not a recognized URL/i)).toHaveCount(0)
  })

  test('valid github shorthand "owner/repo" does NOT show the error', async ({ page }) => {
    await page.goto('/marketplace')
    await page.getByRole('textbox', { name: 'Repository or URL' }).fill('garrytan/gstack')
    await expect(page.getByText(/Not a recognized URL/i)).toHaveCount(0)
    // And the Import button is enabled.
    await expect(page.getByRole('button', { name: /^Import$/ })).toBeEnabled()
  })
})

test.describe('R6 — analytics consolidates duplicate agent categories', () => {
  test('two agent rows that map to "Claude Code" render as ONE donut slice with summed value', async ({ page }) => {
    // Mock /v1/analytics/agents to return TWO claude-flavoured rows.
    await page.route('**/v1/analytics/agents**', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { agent_name: 'claude-code', call_count: 16, pct: 51.6 },
          { agent_name: 'claude', call_count: 9, pct: 29.0 },
        ]),
      }),
    )
    // Other analytics endpoints — return enough to render.
    await page.route('**/v1/analytics/summary**', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total_calls: 25,
          unique_skills: 5,
          unique_agents: 1,
          calls_today: 25,
          most_called_skill: 'demo',
        }),
      }),
    )
    await page.route('**/v1/analytics/skill-calls**', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/v1/analytics/timeline**', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/v1/analytics/collections**', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/v1/analytics/top-skills**', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/v1/analytics/rating-summary**', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          overall_avg: null,
          total_ratings: 0,
          rated_skills: 0,
          rating_agents: 0,
          distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        }),
      }),
    )
    await page.route('**/v1/analytics/ratings**', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    await page.goto('/analytics')

    // The Agent Breakdown bars view (default) renders one row per
    // consolidated category. Exactly ONE bold "Claude Code" label.
    // Wait for the analytics page to render after all the mock responses.
    await expect(page.getByRole('heading', { name: 'Agent Breakdown' })).toBeVisible({ timeout: 10_000 })

    // The raw agent_names appear concatenated next to the consolidated
    // label — this is the strongest single assertion the bug is fixed,
    // because the buggy version had no such text at all (it rendered two
    // separate rows each with only its own raw name).
    await expect(page.getByText(/claude-code, claude/)).toBeVisible({ timeout: 10_000 })

    // And the consolidated value is the sum of the two mocked rows: 25.
    // We assert the call-count text adjacent to the consolidated bar.
    await expect(page.getByText(/^25$/).first()).toBeVisible()
  })

  test('agent filter Select dedups by category (no duplicate "Claude Code" option)', async ({ page }) => {
    // R6 reviewer blocker: the donut/bars consolidation fix didn't propagate
    // to the agentOptions filter dropdown. Verify the dedup now applies
    // there too.
    await page.route('**/v1/analytics/agents**', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { agent_name: 'claude-code', call_count: 16, pct: 51.6 },
          { agent_name: 'claude', call_count: 9, pct: 29.0 },
        ]),
      }),
    )
    // Stub everything else so the page renders without errors.
    for (const path of [
      'summary', 'skill-calls', 'timeline', 'collections', 'top-skills',
    ]) {
      await page.route(`**/v1/analytics/${path}**`, (route: Route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      )
    }
    await page.route('**/v1/analytics/summary**', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total_calls: 25, unique_skills: 5, unique_agents: 1, calls_today: 25, most_called_skill: null }),
      }),
    )
    await page.route('**/v1/analytics/rating-summary**', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ overall_avg: null, total_ratings: 0, rated_skills: 0, rating_agents: 0, distribution: {} }),
      }),
    )

    await page.goto('/analytics')
    await expect(page.getByRole('heading', { name: 'Agent Breakdown' })).toBeVisible({ timeout: 10_000 })

    // Open the "All Agents" filter dropdown. It's a button labelled with
    // the current selection.
    await page.getByRole('button', { name: /All Agents/i }).click()

    // The dropdown should now show: "All Agents" + ONE "Claude Code"
    // option (not two). The FilterDropdown renders plain buttons (no
    // role="option"), so target by exact text within the popped menu.
    // Scope the count to elements with role=button matching the label.
    const ccOptions = page.getByRole('button', { name: /^Claude Code$/ })
    expect(await ccOptions.count()).toBe(1)
  })
})
