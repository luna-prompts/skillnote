/**
 * Round 14 — self-critique fixes for the setup stepper.
 *
 * Bugs each test guards against:
 *
 *  - Dead chrome:// links: previously the stepper rendered
 *    <a href="chrome://extensions" target="_blank">. Browsers block
 *    scripted navigation to chrome:// URLs — the button looked
 *    functional but did nothing. Now we render a copy-to-clipboard
 *    snippet with explicit "paste this into your address bar" copy.
 *
 *  - Safari step-2-4 leakage: previously the Safari warning was
 *    embedded inside Step 1's body, so Safari users still saw steps
 *    2-4 below an "unsupported" message. Now the whole stepper is
 *    replaced with a switch-browsers panel.
 *
 *  - Auto-advance yanking: previously the activeStep effect re-ran on
 *    every state change, so a polled `step1Done=true` would snap the
 *    user out of step 4 if they were peeking. Now we track manual
 *    interaction and stop auto-advancing once the user has clicked.
 *
 *  - CTA hierarchy in step 1: previously GitHub button, extensions-URL
 *    button, AND "I've installed it" all had similar weight in a
 *    single row. Now: GitHub is primary, the "Mark step done" is a
 *    quieter secondary affordance, and the (broken) extensions-URL
 *    link is replaced by a copy-this-URL snippet inside the substeps.
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

test.describe('Step 1 — dead chrome:// links replaced with copy snippets', () => {
  test('step 1 does NOT render a clickable link to chrome://extensions', async ({
    page,
  }) => {
    await wireBase(page, [])
    await page.goto('/settings/integrations/claude-ai')

    const step1 = page.getByTestId('setup-step-1-body')
    await expect(step1).toBeVisible()

    // Find every <a href> inside step 1 — none should target a
    // browser-internal scheme. (chrome:, edge:, brave:, arc:, about:)
    const dangerousHrefs = await step1.locator('a[href]').evaluateAll((els) =>
      (els as HTMLAnchorElement[])
        .map((el) => el.getAttribute('href') ?? '')
        .filter((h) => /^(chrome|edge|brave|arc|about):/i.test(h)),
    )
    expect(dangerousHrefs).toEqual([])
  })

  test('step 1 shows a "paste into your address bar" copy snippet for the extensions URL', async ({
    page,
  }) => {
    await wireBase(page, [])
    await page.goto('/settings/integrations/claude-ai')

    const step1 = page.getByTestId('setup-step-1-body')
    // The body explains why a link wouldn't work.
    await expect(step1.getByText(/paste it into your address bar/i)).toBeVisible()
    // And shows the chrome://extensions text (inside a code/snippet, not a link).
    await expect(step1.getByText('chrome://extensions')).toBeVisible()
  })
})

test.describe('Step 1 — CTA hierarchy', () => {
  test('step 1 has exactly one primary CTA, with "Mark step done" as a secondary affordance', async ({
    page,
  }) => {
    await wireBase(page, [])
    await page.goto('/settings/integrations/claude-ai')

    const step1 = page.getByTestId('setup-step-1-body')
    // Primary action: GitHub link.
    const primary = step1.getByRole('link', { name: /Open repo on GitHub/i })
    await expect(primary).toBeVisible()
    // Secondary completion button — present, but renamed away from the
    // misleading "I've installed it" phrasing.
    await expect(step1.getByRole('button', { name: /Mark step done/i })).toBeVisible()
    // The OLD "I've installed it" wording must not appear anywhere.
    await expect(step1.getByRole('button', { name: /I’ve installed it/i })).not.toBeVisible()
  })
})

test.describe('Safari — whole stepper is replaced', () => {
  test('Safari renders the unsupported-browser panel only', async ({ browser }) => {
    // Override user-agent on a fresh context so detectBrowser() picks Safari.
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    })
    const page = await context.newPage()
    await wireBase(page, [])
    await page.goto('/settings/integrations/claude-ai')

    // The 4-step stepper is gone…
    await expect(page.getByTestId('claude-ai-setup-stepper')).not.toBeVisible()
    // …and the dedicated unsupported panel is shown.
    await expect(page.getByTestId('claude-ai-unsupported-browser')).toBeVisible()
    await expect(page.getByText(/can’t run the SkillNote extension yet/i)).toBeVisible()
    // It offers a way out — links to download Chrome / Firefox.
    await expect(page.getByRole('link', { name: /Download Chrome/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Download Firefox/i })).toBeVisible()
    await context.close()
  })

  test('Chrome users do NOT see the Safari fallback', async ({ page }) => {
    await wireBase(page, [])
    await page.goto('/settings/integrations/claude-ai')
    await expect(page.getByTestId('claude-ai-setup-stepper')).toBeVisible()
    await expect(page.getByTestId('claude-ai-unsupported-browser')).not.toBeVisible()
  })
})

test.describe('Auto-advance does not yank the user', () => {
  test('manually opening step 4 keeps it open even when step 1 lights up later', async ({
    page,
  }) => {
    await wireBase(page, [])
    await page.goto('/settings/integrations/claude-ai')

    // Mark step 1 done first (so we have a state-change to trigger
    // auto-advance after the user navigates away).
    await page.getByRole('button', { name: /Mark step done/i }).click()
    // Auto-advance should land them on step 2 here.
    await expect(page.getByTestId('setup-step-2-body')).toBeVisible()

    // User explores ahead to step 4.
    await page.getByRole('button', { name: /Sign in to claude\.ai/i }).click()
    await expect(page.getByTestId('setup-step-4-body')).toBeVisible()

    // OLD bug: clicking Restart-setup → state changes → auto-advance
    // effect re-fires → step 4 collapses. Fix: userInteracted is
    // already true, so the effect skips. We simulate further state
    // churn by triggering the Refresh button (settings page polls).
    await page.getByRole('button', { name: /^Refresh$/ }).click()

    // Step 4 must still be open. The bug let activeStep snap back.
    await expect(page.getByTestId('setup-step-4-body')).toBeVisible()
  })

  test('Reset stepper appears after manual interaction and resets state', async ({
    page,
  }) => {
    await wireBase(page, [])
    await page.goto('/settings/integrations/claude-ai')

    // Initially no Restart button.
    await expect(page.getByRole('button', { name: /Reset stepper/i })).not.toBeVisible()

    // Mark step 1 done — Restart should appear.
    await page.getByRole('button', { name: /Mark step done/i }).click()
    const restart = page.getByRole('button', { name: /Reset stepper/i })
    await expect(restart).toBeVisible()

    await restart.click()
    // After restart, the "Mark step done" button is back (step 1 is
    // un-completed) and the step counter is back to 0 of 4.
    const stepper = page.getByTestId('claude-ai-setup-stepper')
    await expect(stepper.getByLabel(/0 of 4 steps complete/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Mark step done/i })).toBeVisible()
  })
})

test.describe('Step 2 — clearer puzzle-piece copy', () => {
  test('step 2 explains the puzzle-piece icon AND the SkillNote pin', async ({
    page,
  }) => {
    await wireBase(page, [])
    await page.goto('/settings/integrations/claude-ai')

    await page.getByRole('button', { name: /Open the extension/i }).click()
    const step2 = page.getByTestId('setup-step-2-body')
    await expect(step2).toBeVisible()
    // Old copy conflated puzzle-piece with the SkillNote icon. New copy
    // separates them into discrete sub-steps.
    await expect(step2.getByText(/puzzle-piece/i)).toBeVisible()
    await expect(step2.getByText(/pin/i)).toBeVisible()
    await expect(step2.getByText(/Open settings/i)).toBeVisible()
  })
})
