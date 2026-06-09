/**
 * Round 10 — HealthCard polish.
 *
 * Bugs caught and fixed:
 * 1. The "warn" state used a spinning Loader2 icon, which semantically
 *    reads as "loading" rather than "warning." Switched to a static
 *    AlertTriangle in amber.
 * 2. `failed_ops_total` flowed into the overall-status calculation but
 *    was never rendered as a Stat — users saw a red icon without
 *    knowing why.
 * 3. Once a first load succeeded, subsequent poll failures replaced
 *    the card with nothing user-visible. Now stale data stays visible
 *    with a non-blocking "metrics may be stale" annotation.
 */

import { test, expect, type Page } from '@playwright/test'

async function wireBaseRoutes(page: Page) {
  // The HealthCard renders only once at least one integration exists (first
  // run leads with the setup stepper instead of an empty dashboard), so wire
  // one active integration row for these card-focused tests.
  await page.route('**/v1/integrations/claude-ai/integrations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'hc-int-1',
          browser_label: 'Chrome',
          status: 'active',
          scope: 'both',
          claude_ai_org_id: null,
          last_sync_at: new Date().toISOString(),
          last_error: null,
          conflict_policy: 'ask',
          pending_op_count: 0,
          failed_op_count: 0,
          linked_skill_count: 3,
        },
      ]),
    }),
  )
  await page.route('**/v1/integrations/claude-ai/conflicts', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/v1/integrations/claude-ai/activity**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  // Gated panels that now render alongside the card — mock so they don't make
  // unmocked calls.
  await page.route('**/v1/integrations/claude-ai/queue**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [],
        total: 0,
        pending_count: 0,
        in_progress_count: 0,
        oldest_age_seconds: null,
      }),
    }),
  )
  await page.route('**/v1/integrations/claude-ai/analytics', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        skills_synced_24h: 0,
        skills_synced_7d: 0,
        failed_24h: 0,
        failed_7d: 0,
        sync_success_rate_7d: 1,
        avg_attempts_per_sync_7d: 0,
        top_skills_7d: [],
        per_integration: [],
        sparkline_7d: [],
      }),
    }),
  )
}

async function wireHealth(page: Page, body: object) {
  await page.route('**/v1/integrations/claude-ai/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  )
}

test('Failed ops counter renders its own stat when > 0', async ({ page }) => {
  await wireBaseRoutes(page)
  await wireHealth(page, {
    integrations_active: 2,
    integrations_with_errors: 0,
    pending_ops_total: 0,
    failed_ops_total: 3,
    diverged_links_total: 0,
    last_audit_at: null,
    schema_version: '0020_claude_ai_polish',
  })
  await page.goto('/settings/integrations/claude-ai')

  const card = page.getByTestId('health-card')
  await expect(card).toBeVisible()
  // Each stat now has a stable test id and shows label + value.
  const failed = card.getByTestId('health-stat-failed-ops')
  await expect(failed).toBeVisible()
  await expect(failed).toContainText('3')
  await expect(failed).toContainText('Failed ops')
})

test('Active stat shows the correct value', async ({ page }) => {
  await wireBaseRoutes(page)
  await wireHealth(page, {
    integrations_active: 5,
    integrations_with_errors: 0,
    pending_ops_total: 0,
    failed_ops_total: 0,
    diverged_links_total: 0,
    last_audit_at: null,
    schema_version: '0020_claude_ai_polish',
  })
  await page.goto('/settings/integrations/claude-ai')

  const active = page.getByTestId('health-stat-active')
  await expect(active).toBeVisible()
  await expect(active).toContainText('5')
})

test('Warn state uses a static (non-spinning) icon', async ({ page }) => {
  await wireBaseRoutes(page)
  await wireHealth(page, {
    integrations_active: 1,
    integrations_with_errors: 0,
    pending_ops_total: 60, // > 50 → warn
    failed_ops_total: 0,
    diverged_links_total: 0,
    last_audit_at: null,
    schema_version: '0020_claude_ai_polish',
  })
  await page.goto('/settings/integrations/claude-ai')

  const icon = page.getByTestId('health-icon')
  await expect(icon).toBeVisible()
  // The fix: no spinning loader on warn — only static alert triangle.
  const cls = (await icon.getAttribute('class')) ?? ''
  expect(cls).not.toContain('animate-spin')
  // And the color should be the amber warn tone.
  expect(cls).toContain('text-amber-500')
})

test('Bad state (errors present) uses the red tone, not amber', async ({ page }) => {
  await wireBaseRoutes(page)
  await wireHealth(page, {
    integrations_active: 1,
    integrations_with_errors: 2,
    pending_ops_total: 0,
    failed_ops_total: 0,
    diverged_links_total: 0,
    last_audit_at: null,
    schema_version: '0020_claude_ai_polish',
  })
  await page.goto('/settings/integrations/claude-ai')

  const icon = page.getByTestId('health-icon')
  await expect(icon).toBeVisible()
  const cls = (await icon.getAttribute('class')) ?? ''
  expect(cls).toContain('text-red-500')
})

test('"With errors" stat highlights red when > 0', async ({ page }) => {
  await wireBaseRoutes(page)
  await wireHealth(page, {
    integrations_active: 1,
    integrations_with_errors: 2,
    pending_ops_total: 0,
    failed_ops_total: 0,
    diverged_links_total: 0,
    last_audit_at: null,
    schema_version: '0020_claude_ai_polish',
  })
  await page.goto('/settings/integrations/claude-ai')

  const stat = page.getByTestId('health-stat-with-errors')
  await expect(stat).toBeVisible()
  await expect(stat).toContainText('2')
  // The number itself should be styled red, not the label.
  const numberDiv = stat.locator('div').first()
  const cls = (await numberDiv.getAttribute('class')) ?? ''
  expect(cls).toContain('text-red-500')
})

test('First-load error renders the explanatory fallback (no spinner)', async ({
  page,
}) => {
  await wireBaseRoutes(page)
  // Every request fails — no data ever lands.
  await page.route('**/v1/integrations/claude-ai/health', (route) =>
    route.fulfill({ status: 500, body: 'kaboom' }),
  )
  await page.goto('/settings/integrations/claude-ai')

  await expect(page.getByText(/Could not load health metrics/)).toBeVisible({
    timeout: 5_000,
  })
})
