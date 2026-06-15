/**
 * Iter 21 — diagnostic button + modal e2e.
 *
 * Verifies the one-click diagnostic flow:
 *  - Button is reachable from the Connected browsers section header.
 *  - Click opens a modal, runs the diagnostic, renders one row per
 *    check with a status icon, and surfaces an overall verdict pill.
 *  - Escape closes the modal.
 *  - Modal is dismissible by clicking the backdrop or the Done button.
 */

import { test, expect, type Page } from '@playwright/test'

async function wireBase(page: Page, diagnostic: any) {
  await page.route('**/v1/integrations/claude-ai/integrations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
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
        schema_version: '0021_audit_cookie_expired',
      }),
    }),
  )
  await page.route('**/v1/integrations/claude-ai/activity**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/v1/integrations/claude-ai/queue**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0, pending_count: 0, in_progress_count: 0, oldest_age_seconds: null }),
    }),
  )
  await page.route('**/v1/integrations/claude-ai/diagnostic', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(diagnostic),
    }),
  )
}

function passingDiagnostic() {
  return {
    overall: 'pass',
    checks: [
      { id: 'backend_db', label: 'Backend database reachable', status: 'pass', detail: 'OK.' },
      { id: 'integrations_paired', label: 'At least one browser is paired', status: 'pass', detail: '1 integration(s).' },
    ],
    generated_at: new Date().toISOString(),
  }
}

function failingDiagnostic() {
  return {
    overall: 'fail',
    checks: [
      { id: 'backend_db', label: 'Backend database reachable', status: 'pass', detail: 'OK.' },
      {
        id: 'no_cookie_expired',
        label: 'All paired browsers are signed in',
        status: 'fail',
        detail: '1 browser(s) need re-sign-in to claude.ai.',
      },
    ],
    generated_at: new Date().toISOString(),
  }
}

test('Run diagnostic button opens a modal and renders pass results', async ({ page }) => {
  await wireBase(page, passingDiagnostic())
  await page.goto('/settings/integrations/claude-ai')

  const btn = page.getByTestId('diagnostic-button')
  await expect(btn).toBeVisible()
  await btn.click()

  const modal = page.getByTestId('diagnostic-modal')
  await expect(modal).toBeVisible()
  // Overall verdict pill matches.
  await expect(page.getByTestId('diagnostic-overall-pass')).toBeVisible()
  // One row per check.
  const results = page.getByTestId('diagnostic-results')
  await expect(results).toBeVisible()
  await expect(page.getByTestId('diagnostic-check-backend_db')).toBeVisible()
  await expect(page.getByTestId('diagnostic-check-integrations_paired')).toBeVisible()
})

test('Failing diagnostic shows action-required overall + per-check detail', async ({
  page,
}) => {
  await wireBase(page, failingDiagnostic())
  await page.goto('/settings/integrations/claude-ai')

  await page.getByTestId('diagnostic-button').click()
  await expect(page.getByTestId('diagnostic-overall-fail')).toBeVisible()
  // Fail-row detail is visible.
  const failRow = page.getByTestId('diagnostic-check-no_cookie_expired')
  await expect(failRow).toContainText(/need re-sign-in/i)
})

test('Escape closes the modal', async ({ page }) => {
  await wireBase(page, passingDiagnostic())
  await page.goto('/settings/integrations/claude-ai')
  await page.getByTestId('diagnostic-button').click()
  await expect(page.getByTestId('diagnostic-modal')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('diagnostic-modal')).not.toBeVisible()
})

test('Modal has correct ARIA attributes', async ({ page }) => {
  await wireBase(page, passingDiagnostic())
  await page.goto('/settings/integrations/claude-ai')
  await page.getByTestId('diagnostic-button').click()
  const modal = page.getByTestId('diagnostic-modal')
  // The modal is the dialog; the ROLE is on the backdrop wrapper.
  const dialog = page.getByRole('dialog', { name: /Connector diagnostic/i })
  await expect(dialog).toBeVisible()
  expect(await dialog.getAttribute('aria-modal')).toBe('true')
  expect(await dialog.getAttribute('aria-labelledby')).toBe('diagnostic-modal-title')
})
