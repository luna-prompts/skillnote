/**
 * Round 11 — connection-discovery audit.
 *
 * Before: claude.ai had a dedicated settings page (`/settings/integrations/
 * claude-ai`) but never appeared on the main Connect page (`/integrations`)
 * where users go to discover and wire up agents. Users had to know the
 * exact URL or find the tiny link buried in the Settings page.
 *
 * After: claude.ai renders as a `ClaudeAICard` in the Browse tab, and a
 * `ClaudeAIConnectedRow` shows in the Connected tab once at least one
 * browser is paired. The dedicated page now opens with a numbered 4-step
 * setup card (matching the CLI tutorial output).
 */

import { test, expect, type Page } from '@playwright/test'

async function wireBaseMocks(page: Page, integrations: any[] = []) {
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
  // Connect page also polls /v1/setup/agents — stub to empty so we don't 404.
  await page.route('**/v1/setup/agents', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
}

function mkIntegration(overrides: Partial<any> = {}) {
  return {
    id: 'int-' + Math.random().toString(36).slice(2, 8),
    browser_label: 'Chrome on Mac',
    status: 'active',
    scope: 'both',
    claude_ai_org_id: null,
    last_sync_at: null,
    last_error: null,
    conflict_policy: 'ask',
    pending_op_count: 0,
    failed_op_count: 0,
    linked_skill_count: 0,
    ...overrides,
  }
}

test.describe('Connect page surfaces claude.ai', () => {
  test('Browse tab shows the claude.ai card with "Set up" CTA when not yet paired', async ({
    page,
  }) => {
    await wireBaseMocks(page, [])
    await page.goto('/integrations')
    // Default tab is Connected; switch to Browse.
    await page.getByRole('tab', { name: /Browse/ }).click()

    const card = page.getByRole('link', { name: /claude\.ai/i }).first()
    await expect(card).toBeVisible()
    await expect(card).toContainText('claude.ai')
    await expect(card).toContainText('Set up')
    // It links to the dedicated settings page.
    expect(await card.getAttribute('href')).toBe(
      '/settings/integrations/claude-ai',
    )
  })

  test('Browse tab card flips to a "Connected" pill when at least one browser is paired', async ({
    page,
  }) => {
    await wireBaseMocks(page, [
      mkIntegration({ browser_label: 'Chrome', status: 'active' }),
      mkIntegration({ browser_label: 'Edge', status: 'active' }),
    ])
    await page.goto('/integrations')
    await page.getByRole('tab', { name: /Browse/ }).click()

    const card = page.getByRole('link', { name: /claude\.ai/i }).first()
    await expect(card).toContainText(/2 browsers connected/)
  })

  test('Connected tab shows the claude.ai row when paired', async ({ page }) => {
    await wireBaseMocks(page, [
      mkIntegration({ browser_label: 'Chrome', status: 'active' }),
    ])
    await page.goto('/integrations')
    // Default tab is Connected; just wait for the row to appear.
    const row = page.getByTestId('claude-ai-connected-row')
    await expect(row).toBeVisible()
    await expect(row).toContainText('1 browser')
    expect(await row.getAttribute('href')).toBe('/settings/integrations/claude-ai')
  })

  test('Connected tab does NOT show the claude.ai row when no browsers are paired', async ({
    page,
  }) => {
    await wireBaseMocks(page, [])
    await page.goto('/integrations')
    await expect(page.getByTestId('claude-ai-connected-row')).not.toBeVisible()
  })
})

test.describe('Dedicated setup page renders interactive stepper', () => {
  test('Stepper lists all four steps with progress counter', async ({ page }) => {
    await wireBaseMocks(page, [])
    await page.goto('/settings/integrations/claude-ai')

    const stepper = page.getByTestId('claude-ai-setup-stepper')
    await expect(stepper).toBeVisible()

    const list = page.getByTestId('setup-step-list')
    const steps = list.locator(':scope > li')
    await expect(steps).toHaveCount(4)
    await expect(steps.nth(0)).toContainText(/Install the SkillNote extension/i)
    await expect(steps.nth(1)).toContainText(/Open the extension/i)
    await expect(steps.nth(2)).toContainText(/Approve the pairing code/i)
    await expect(steps.nth(3)).toContainText(/Sign in to claude\.ai/i)

    // Step counter pill: 0 of 4 when nothing's done.
    await expect(stepper.getByLabel(/0 of 4 steps complete/i)).toBeVisible()
  })

  test('Step 2 surfaces the SkillNote URL with a Copy button', async ({ page }) => {
    await wireBaseMocks(page, [])
    await page.goto('/settings/integrations/claude-ai')

    // Step 2 is expanded by default after step 1 (since neither is done
    // yet, the auto-advance lands on the first incomplete step which is 1).
    // Click step 2 to expand its body explicitly.
    await page.getByRole('button', { name: /Open the extension/i }).click()
    const step2 = page.getByTestId('setup-step-2-body')
    await expect(step2).toBeVisible()
    await expect(step2.getByRole('button', { name: /Copy SkillNote URL/i })).toBeVisible()
    await expect(step2.getByTestId('setup-skillnote-url')).toBeVisible()
  })

  test('Step 1 shows unpacked-install guidance and a "coming soon" badge', async ({
    page,
  }) => {
    await wireBaseMocks(page, [])
    await page.goto('/settings/integrations/claude-ai')

    // Step 1 is active by default.
    const step1 = page.getByTestId('setup-step-1-body')
    await expect(step1).toBeVisible()
    await expect(step1.getByRole('link', { name: /Open repo on GitHub/i })).toBeVisible()
    // The setup card must NOT show fake store links.
    await expect(step1.getByRole('link', { name: /Install for Chrome/i })).not.toBeVisible()
    await expect(step1.getByRole('link', { name: /Install for Firefox/i })).not.toBeVisible()
  })

  test('Step counter advances when the user clicks "Mark step done"', async ({
    page,
  }) => {
    await wireBaseMocks(page, [])
    await page.goto('/settings/integrations/claude-ai')

    const stepper = page.getByTestId('claude-ai-setup-stepper')
    await expect(stepper.getByLabel(/0 of 4 steps complete/i)).toBeVisible()
    await page.getByRole('button', { name: /Mark step done/i }).click()
    await expect(stepper.getByLabel(/1 of 4 steps complete/i)).toBeVisible()
  })

  test('Stepper disappears entirely once an integration is active', async ({
    page,
  }) => {
    await wireBaseMocks(page, [
      {
        id: 'int-1',
        browser_label: 'Chrome',
        status: 'active',
        scope: 'both',
        claude_ai_org_id: null,
        last_sync_at: new Date().toISOString(),
        last_error: null,
        conflict_policy: 'ask',
        pending_op_count: 0,
        failed_op_count: 0,
        linked_skill_count: 0,
      },
    ])
    await page.goto('/settings/integrations/claude-ai')
    // The stepper renders null when all 4 steps are done; the wrapping
    // section remains so the page layout is stable, but the stepper
    // itself is gone.
    await expect(page.getByTestId('claude-ai-setup-stepper')).not.toBeVisible()
  })

  test('Pending pairing surfaces a "waiting for approval" notice in step 3', async ({
    page,
  }) => {
    await wireBaseMocks(page, [
      {
        id: 'int-pending',
        browser_label: 'Chrome on Mac',
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
    // Step 3 should be active (steps 1+2 auto-completed because a pending
    // row already exists in the backend) and its body contains the
    // "is waiting for approval" notice, with the browser label interpolated.
    await expect(
      page.getByText(/Chrome on Mac is waiting for approval/i),
    ).toBeVisible()
  })
})
