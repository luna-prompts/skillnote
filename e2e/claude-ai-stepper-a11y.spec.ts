/**
 * Round 13 — UX overhaul focus + a11y coverage for the new stepper.
 *
 * The stepper is the main onboarding surface for non-technical users.
 * A few invariants matter:
 *
 *   - `aria-expanded` flips correctly when the user navigates steps.
 *   - `aria-controls` points at a real id (so screen readers can jump).
 *   - Step buttons remain keyboard-reachable.
 *   - Step counter is announceable (aria-label includes the human form).
 *   - The "Mark step done" affordance only renders before the user
 *     has actually installed (i.e., before any integration exists).
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
        integrations_active: integrations.filter((i) => i.status === 'active').length,
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

test('clicking each step header expands it and collapses the others', async ({ page }) => {
  await wireBase(page, [])
  await page.goto('/settings/integrations/claude-ai')

  // Step 1 is auto-active when nothing is done.
  await expect(page.getByTestId('setup-step-1-body')).toBeVisible()

  // Click step 3.
  await page.getByRole('button', { name: /Approve the pairing code/i }).click()
  await expect(page.getByTestId('setup-step-3-body')).toBeVisible()
  await expect(page.getByTestId('setup-step-1-body')).not.toBeVisible()

  // Step buttons have aria-expanded reflecting the open state.
  await expect(
    page.getByRole('button', { name: /Approve the pairing code/i }),
  ).toHaveAttribute('aria-expanded', 'true')
  await expect(
    page.getByRole('button', { name: /Install the SkillNote extension/i }),
  ).toHaveAttribute('aria-expanded', 'false')
})

test('aria-controls on step button points at the rendered body id', async ({
  page,
}) => {
  await wireBase(page, [])
  await page.goto('/settings/integrations/claude-ai')

  const btn = page.getByRole('button', { name: /Install the SkillNote extension/i })
  const controlsId = await btn.getAttribute('aria-controls')
  expect(controlsId).toBe('setup-step-body-1')
  // The element with that id exists once the step is expanded.
  await expect(page.locator('#setup-step-body-1')).toBeVisible()
})

test('"Mark step done" hides once step 1 is marked done', async ({ page }) => {
  await wireBase(page, [])
  await page.goto('/settings/integrations/claude-ai')

  const ack = page.getByRole('button', { name: /Mark step done/i })
  await expect(ack).toBeVisible()
  await ack.click()
  // After clicking, step 1 is done — the affordance disappears.
  await expect(ack).not.toBeVisible()
})

test('"Mark step done" never renders when an integration already exists', async ({
  page,
}) => {
  await wireBase(page, [
    {
      id: 'int-1',
      browser_label: 'Chrome',
      status: 'pending_approval',
      scope: 'both',
      claude_ai_org_id: null,
      last_sync_at: null,
      last_error: null,
      conflict_policy: 'ask',
      pending_op_count: 0,
      failed_op_count: 0,
      linked_skill_count: 0,
    },
  ])
  await page.goto('/settings/integrations/claude-ai')

  // Even when we expand step 1, the ack button is gone because step 1
  // is auto-done by the presence of an integration row.
  await page.getByRole('button', { name: /Install the SkillNote extension/i }).click()
  await expect(page.getByRole('button', { name: /Mark step done/i })).not.toBeVisible()
})

test('step counter has an accessible label', async ({ page }) => {
  await wireBase(page, [])
  await page.goto('/settings/integrations/claude-ai')
  const stepper = page.getByTestId('claude-ai-setup-stepper')
  await expect(stepper.getByLabel(/0 of 4 steps complete/)).toBeVisible()
})

test('step counter reflects partial progress when pending pair exists', async ({
  page,
}) => {
  await wireBase(page, [
    {
      id: 'int-1',
      browser_label: 'Chrome',
      status: 'pending_approval',
      scope: 'both',
      claude_ai_org_id: null,
      last_sync_at: null,
      last_error: null,
      conflict_policy: 'ask',
      pending_op_count: 0,
      failed_op_count: 0,
      linked_skill_count: 0,
    },
  ])
  await page.goto('/settings/integrations/claude-ai')
  const stepper = page.getByTestId('claude-ai-setup-stepper')
  // Steps 1 + 2 auto-complete; step 3 is active waiting for approval.
  await expect(stepper.getByLabel(/2 of 4 steps complete/)).toBeVisible()
})
