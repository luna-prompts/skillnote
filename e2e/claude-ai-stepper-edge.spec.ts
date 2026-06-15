/**
 * Round 16 — last critique pass on the setup stepper.
 *
 *  - Per-backend install-ack scoping: the localStorage key is keyed by
 *    API base URL so a user with multiple SkillNote instances doesn't
 *    see cross-contamination of the "I've installed it" flag.
 *
 *  - "Reset stepper" label: the previous "Restart setup" wording
 *    suggested a factory-reset that would unpair browsers. Renamed +
 *    added a title attr clarifying it only affects the UI stepper.
 */

import { test, expect, type Page } from '@playwright/test'

async function wireBase(page: Page, integrations: any[] = []) {
  await page.route('**/v1/integrations/claude-ai/integrations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(integrations),
    }),
  )
  await page.route('**/v1/integrations/claude-ai/conflicts', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/v1/integrations/claude-ai/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        integrations_active: 0,
        integrations_with_errors: 0,
        pending_ops_total: 0,
        failed_ops_total: 0,
        diverged_links_total: 0,
        last_audit_at: null,
        schema_version: '0020_claude_ai_polish',
      }),
    }),
  )
  await page.route('**/v1/integrations/claude-ai/activity**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
}

test('install-ack localStorage key is scoped by API base URL', async ({ page }) => {
  await wireBase(page, [])
  await page.goto('/settings/integrations/claude-ai')
  // Mark step 1 done.
  await page.getByRole('button', { name: /Mark step done/i }).click()
  // Read the localStorage keys that were written.
  const keys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) =>
      k.startsWith('skillnote:claude-ai:install-acknowledged'),
    ),
  )
  expect(keys.length).toBeGreaterThanOrEqual(1)
  // The key must contain a URL/base suffix — never the bare unscoped key.
  expect(keys.every((k) => k.length > 'skillnote:claude-ai:install-acknowledged'.length + 1)).toBe(true)
})

test('"Reset stepper" label explains it does not unpair browsers', async ({ page }) => {
  await wireBase(page, [])
  await page.goto('/settings/integrations/claude-ai')
  // Trigger the reset button to appear.
  await page.getByRole('button', { name: /Mark step done/i }).click()
  const reset = page.getByRole('button', { name: /Reset stepper/i })
  await expect(reset).toBeVisible()
  // The title attr explains the no-unpair contract.
  const title = await reset.getAttribute('title')
  expect(title).toMatch(/doesn.?t unpair/i)
  // Old "Restart setup" wording is gone everywhere on the page.
  await expect(page.getByText(/Restart setup/)).not.toBeVisible()
})

test('stepper reset un-marks step 1 done and returns counter to 0', async ({ page }) => {
  await wireBase(page, [])
  await page.goto('/settings/integrations/claude-ai')

  const stepper = page.getByTestId('claude-ai-setup-stepper')
  await expect(stepper.getByLabel(/0 of 4 steps complete/i)).toBeVisible()

  await page.getByRole('button', { name: /Mark step done/i }).click()
  await expect(stepper.getByLabel(/1 of 4 steps complete/i)).toBeVisible()

  await page.getByRole('button', { name: /Reset stepper/i }).click()
  await expect(stepper.getByLabel(/0 of 4 steps complete/i)).toBeVisible()
  // And the localStorage flag is cleared.
  const remaining = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('skillnote:claude-ai:install-acknowledged'))
      .map((k) => localStorage.getItem(k)),
  )
  expect(remaining).toEqual([])
})
