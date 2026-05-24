/**
 * Round 15 — self-critique fixes for stepper polish.
 *
 *  - Troubleshoot section: a non-technical user always needs an escape
 *    hatch. The 5 most common failure modes are now in a collapsible
 *    "Stuck? Common fixes" section under the steps.
 *
 *  - Step 4 honesty: previously step 4 marked done the instant
 *    integration.status flipped to 'active'. But that only proves the
 *    extension paired — not that claude.ai is reachable. We now require
 *    last_sync_at !== null before marking step 4 done, and surface a
 *    blue "Waiting for first sync" notice in the in-between state.
 *
 *  - Snippet overflow: no more truncate — long commands scroll
 *    horizontally and remain fully visible/inspectable.
 *
 *  - First-paint flash: header subtitle is stable ("Setup takes about a
 *    minute") and the detected-browser label appears as a separate
 *    pill once detection runs.
 *
 *  - Step 3 clearer messaging: numbered "approve in the other tab"
 *    steps so non-tech users know WHERE to click.
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

test.describe('Troubleshoot section', () => {
  test('Troubleshoot is collapsed by default and toggles open', async ({ page }) => {
    await wireBase(page, [])
    await page.goto('/settings/integrations/claude-ai')

    const ts = page.getByTestId('claude-ai-troubleshoot')
    await expect(ts).toBeVisible()
    // Collapsed initially — only the header is present.
    await expect(ts.getByRole('button', { name: /Stuck.*Common fixes/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await ts.getByRole('button', { name: /Stuck.*Common fixes/i }).click()
    await expect(ts.getByRole('button', { name: /Stuck.*Common fixes/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    // The five common-fix items are visible.
    await expect(ts.getByText(/extension doesn.t show up/i)).toBeVisible()
    await expect(ts.getByText(/don.t see a SkillNote icon/i)).toBeVisible()
    await expect(ts.getByText(/pairing code doesn.t appear/i)).toBeVisible()
    await expect(ts.getByText(/Sign-in to claude\.ai.*still shows/i)).toBeVisible()
    await expect(ts.getByText(/Nothing syncs/i)).toBeVisible()
  })
})

test.describe('Step 4 honesty', () => {
  test('Active integration without last_sync_at keeps step 4 incomplete', async ({
    page,
  }) => {
    await wireBase(page, [
      {
        id: 'int-1',
        browser_label: 'Chrome',
        status: 'active',
        scope: 'both',
        claude_ai_org_id: null,
        last_sync_at: null, // ← the key field — first sync hasn't fired
        last_error: null,
        conflict_policy: 'ask',
        pending_op_count: 0,
        failed_op_count: 0,
        linked_skill_count: 0,
      },
    ])
    await page.goto('/settings/integrations/claude-ai')
    const stepper = page.getByTestId('claude-ai-setup-stepper')
    // Steps 1+2+3 done (3/4) — step 4 still incomplete because no sync yet.
    await expect(stepper.getByLabel(/3 of 4 steps complete/i)).toBeVisible()
    // The "Waiting for first sync" panel is visible inside step 4's body.
    await page.getByRole('button', { name: /Sign in to claude\.ai/i }).click()
    await expect(page.getByText(/Waiting for first sync/i)).toBeVisible()
  })

  test('Active integration with last_sync_at hides the stepper entirely', async ({
    page,
  }) => {
    await wireBase(page, [
      {
        id: 'int-2',
        browser_label: 'Chrome',
        status: 'active',
        scope: 'both',
        claude_ai_org_id: null,
        last_sync_at: new Date().toISOString(),
        last_error: null,
        conflict_policy: 'ask',
        pending_op_count: 0,
        failed_op_count: 0,
        linked_skill_count: 1,
      },
    ])
    await page.goto('/settings/integrations/claude-ai')
    // All 4 steps done → stepper returns null.
    await expect(page.getByTestId('claude-ai-setup-stepper')).not.toBeVisible()
  })
})

test.describe('First-paint stability', () => {
  test('header subtitle is stable; detected-browser is a separate badge', async ({
    page,
  }) => {
    await wireBase(page, [])
    await page.goto('/settings/integrations/claude-ai')
    const stepper = page.getByTestId('claude-ai-setup-stepper')
    // The generic copy is always present (no flash-and-replace).
    await expect(stepper.getByText(/Setup takes about a minute\./)).toBeVisible()
    // The detected-browser appears as its own labelled pill.
    await expect(stepper.getByTestId('detected-browser-badge')).toBeVisible()
  })
})

test.describe('Snippet overflow', () => {
  test('long commands use horizontal scroll, not truncate', async ({ page }) => {
    await wireBase(page, [])
    await page.goto('/settings/integrations/claude-ai')

    const step1 = page.getByTestId('setup-step-1-body')
    // Find the snippet that contains the npm command.
    const code = step1.locator('code', {
      hasText: /cd extensions\/claude-ai && npm install && npm run build/,
    })
    await expect(code).toBeVisible()
    const cls = (await code.getAttribute('class')) ?? ''
    expect(cls).toContain('overflow-x-auto')
    expect(cls).not.toContain('truncate')
  })
})

test.describe('Step 3 clearer messaging', () => {
  test('Pending pair shows numbered approval steps with browser label', async ({
    page,
  }) => {
    await wireBase(page, [
      {
        id: 'int-pending',
        browser_label: 'Chrome on MacBook Air',
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

    const banner = page.getByTestId('step-3-waiting-banner')
    await expect(banner).toBeVisible()
    // Browser label is interpolated so the user knows which browser.
    await expect(banner).toContainText('Chrome on MacBook Air')
    // Numbered ol of approval steps (3 items).
    await expect(banner.locator('ol > li')).toHaveCount(3)
  })
})
